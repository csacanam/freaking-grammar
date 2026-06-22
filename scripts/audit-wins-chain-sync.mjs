// Audit wins ↔ chain consistency across the whole pots table.
//
// Companion to scripts/audit-day-number-skew.mjs. Now that day_number
// is reconciled, we still have three classes of BD/chain drift that
// the 2026-05-31 Alchemy incident (and the off-by-one bug it caused
// in roll-day) can leave behind:
//
//   1. "BOGUS_WINS" — wins row in BD names player A, but the
//      contract says player B won that (game, day). The BD row
//      points the frontend at a claim that will always revert
//      with NotWinner.
//   2. "MISSING_WINS" — chain says someone won (game, day) with
//      claimed=false and pot > 0, but no BD wins row exists for
//      them. The real winner has on-chain prize they can't see
//      via /you.
//   3. "STALE_CLAIMED" — BD says claimed=false but chain says
//      claimed=true. The user already received the prize; the BD
//      just never noticed (no cron syncs claim_tx back from chain).
//
// Read-only by default. Pass --execute to apply fixes:
//   - BOGUS_WINS → DELETE the wins row (player didn't win)
//   - MISSING_WINS → INSERT a wins row for the real winner
//   - STALE_CLAIMED → UPDATE wins.claimed = true
//
// All three are surgical, reversible, and don't touch the chain.

import { readFileSync } from "node:fs";
import { createPublicClient, http, parseAbiItem, getAddress } from "viem";
import { celo } from "viem/chains";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const SUPA = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const POT = getAddress("0x88a59c58Ca70DF6971F9499f6117A2BA41653e3e");
const c = createPublicClient({
  chain: celo,
  transport: http("https://forno.celo.org"),
});

const POT_ABI = [
  parseAbiItem("function winnerOf(uint256, uint256) view returns (address)"),
  parseAbiItem("function claimed(uint256, uint256) view returns (bool)"),
  parseAbiItem("function pot(uint256, uint256) view returns (uint256)"),
  parseAbiItem("function currentDay(uint256) view returns (uint256)"),
];

const ZERO = "0x0000000000000000000000000000000000000000";
const execute = process.argv.includes("--execute");

console.log("Loading pots + wins from BD…");
const { data: pots } = await SUPA.from("pots")
  .select("*")
  .not("day_number", "is", null)
  .order("day_utc");
const { data: wins } = await SUPA.from("wins").select("*");
console.log(`  ${pots.length} pots rows · ${wins.length} wins rows`);
console.log("");

// Skip the currently-active day per game (no winner yet on chain).
const activeDays = new Map();
for (const gid of [1n, 2n, 3n]) {
  const cur = await c.readContract({
    address: POT,
    abi: POT_ABI,
    functionName: "currentDay",
    args: [gid],
  });
  activeDays.set(Number(gid), Number(cur));
}
console.log("Active days on chain:", Object.fromEntries(activeDays));
console.log("");

const bogus = []; // BD wins row with wrong player
const missing = []; // chain winner with no BD row
const stale = []; // BD claimed=false, chain claimed=true
let compensated = 0; // off-chain compensated rows (skipped, not bogus)

console.log("Scanning pots vs chain… (one winnerOf+claimed+pot call per row)");
let scanned = 0;
for (const p of pots) {
  // Skip pots rows for days the chain still has as active — no winner
  // recorded yet, by design.
  if (activeDays.get(p.game_id) === p.day_number) continue;
  scanned++;

  let chainWinner, chainClaimed, chainPot;
  try {
    [chainWinner, chainClaimed, chainPot] = await Promise.all([
      c.readContract({
        address: POT,
        abi: POT_ABI,
        functionName: "winnerOf",
        args: [BigInt(p.game_id), BigInt(p.day_number)],
      }),
      c.readContract({
        address: POT,
        abi: POT_ABI,
        functionName: "claimed",
        args: [BigInt(p.game_id), BigInt(p.day_number)],
      }),
      c.readContract({
        address: POT,
        abi: POT_ABI,
        functionName: "pot",
        args: [BigInt(p.game_id), BigInt(p.day_number)],
      }),
    ]);
  } catch (e) {
    console.warn(`  read failed for ${p.game} ${p.day_utc}: ${e.message.slice(0, 60)}`);
    continue;
  }

  const chainWinnerLc = chainWinner.toLowerCase();
  const noChainWinner = chainWinnerLc === ZERO;

  // Find all BD wins rows for this pot.
  const matchingWins = wins.filter(
    (w) => w.game_id === p.game_id && w.day_utc === p.day_utc,
  );

  if (noChainWinner) {
    // Chain hasn't picked a winner. If BD has wins rows here, they're
    // either bogus (pre-rollDay phantom data) OR off-chain compensation
    // rows we inserted after withdrawTreasury to compensate the player
    // for a day chain failed to roll properly (claimed=true + claim_tx
    // pointing at the compensation tx — see
    // scripts/compensate-outage-2026-05-31.mjs).
    for (const w of matchingWins) {
      if (w.claimed && w.claim_tx) {
        compensated++;
        continue;
      }
      bogus.push({
        ...w,
        reason: "no chain winner — chain never rolled this day",
      });
    }
    continue;
  }

  // Chain has a winner. Make sure there's exactly one BD wins row and
  // it points at the right player.
  const correctRow = matchingWins.find(
    (w) => w.player.toLowerCase() === chainWinnerLc,
  );
  const wrongRows = matchingWins.filter(
    (w) => w.player.toLowerCase() !== chainWinnerLc,
  );

  for (const w of wrongRows) {
    bogus.push({
      ...w,
      reason: `chain winner is ${chainWinnerLc}, BD has ${w.player}`,
    });
  }

  if (!correctRow && Number(chainPot) > 0) {
    missing.push({
      game_id: p.game_id,
      game: p.game,
      lang: p.lang,
      day_utc: p.day_utc,
      day_number: p.day_number,
      player: chainWinnerLc,
      amount_units: chainPot.toString(),
      claimed: chainClaimed,
      reason: `chain winner ${chainWinnerLc} has ${Number(chainPot) / 1e6} USDT, no BD row`,
    });
  }

  if (correctRow && chainClaimed && !correctRow.claimed) {
    stale.push({
      ...correctRow,
      reason: "chain claimed=true but BD claimed=false",
    });
  }
}

console.log(`Scanned ${scanned} pots rows.`);
if (compensated > 0) {
  console.log(
    `(skipped ${compensated} off-chain compensation rows — claimed=true with claim_tx, chain winner=0x0)`,
  );
}
console.log("");

console.log(`=== BOGUS wins (${bogus.length}) — wins rows in BD with wrong player ===`);
for (const b of bogus) {
  console.log(
    `  ${b.game.padEnd(7)} lang=${(b.lang || "-").padEnd(3)} day=${b.day_utc} player=${b.player.slice(0, 12)}…  ${b.reason}`,
  );
}
console.log("");

console.log(`=== MISSING wins (${missing.length}) — chain winners with no BD row ===`);
for (const m of missing) {
  console.log(
    `  ${m.game.padEnd(7)} lang=${(m.lang || "-").padEnd(3)} day=${m.day_utc} dayN=${m.day_number} player=${m.player.slice(0, 12)}…  ${m.reason}`,
  );
}
console.log("");

console.log(`=== STALE claimed (${stale.length}) — BD says false but chain says true ===`);
for (const s of stale) {
  console.log(
    `  ${s.game.padEnd(7)} lang=${(s.lang || "-").padEnd(3)} day=${s.day_utc} player=${s.player.slice(0, 12)}…`,
  );
}
console.log("");

if (!execute) {
  console.log(
    `Total: ${bogus.length} bogus + ${missing.length} missing + ${stale.length} stale. Re-run with --execute to apply.`,
  );
  process.exit(0);
}

console.log("=== APPLYING FIXES ===");

let deleted = 0;
for (const b of bogus) {
  const { error } = await SUPA.from("wins")
    .delete()
    .eq("game_id", b.game_id)
    .eq("day_utc", b.day_utc)
    .eq("player", b.player);
  if (error) console.log(`  ✗ delete ${b.player} ${b.day_utc}: ${error.message}`);
  else {
    deleted++;
    console.log(`  ✓ deleted bogus: ${b.game} ${b.day_utc} player=${b.player.slice(0, 12)}…`);
  }
}

let inserted = 0;
for (const m of missing) {
  const { error } = await SUPA.from("wins").insert({
    game: m.game,
    game_id: m.game_id,
    lang: m.lang,
    day_utc: m.day_utc,
    player: m.player,
    amount_units: m.amount_units,
    claimed: m.claimed,
  });
  if (error) console.log(`  ✗ insert ${m.player} ${m.day_utc}: ${error.message}`);
  else {
    inserted++;
    console.log(`  ✓ inserted missing: ${m.game} ${m.day_utc} player=${m.player.slice(0, 12)}…  ${Number(m.amount_units) / 1e6} USDT`);
  }
}

let claimedFixed = 0;
for (const s of stale) {
  const { error } = await SUPA.from("wins")
    .update({ claimed: true })
    .eq("game_id", s.game_id)
    .eq("day_utc", s.day_utc)
    .eq("player", s.player);
  if (error) console.log(`  ✗ update ${s.player} ${s.day_utc}: ${error.message}`);
  else {
    claimedFixed++;
    console.log(`  ✓ marked claimed: ${s.game} ${s.day_utc} player=${s.player.slice(0, 12)}…`);
  }
}

console.log("");
console.log(`Applied: ${deleted} deletes, ${inserted} inserts, ${claimedFixed} updates.`);
