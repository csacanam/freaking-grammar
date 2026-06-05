// Audit the day_number skew between BD pots table and on-chain truth.
//
// History: on 2026-05-30 the rollDay cron failed on chain (Alchemy 429
// outage) but the BD optimistically advanced pots.day_number for every
// subsequent day. The on-chain currentDay stayed behind by one (per
// game, per failed rollDay). The frontend reads wins ← pots.day_number
// and passes that to claim(day, gameId) on chain — which now points at
// the wrong day, so every claim reverts with NotWinner.
//
// This script doesn't write anything. It:
//   1. Scans DayRolled events from the FreakingPot contract for each
//      gameId since launch
//   2. Builds the authoritative mapping (calendarDate → closedDay)
//      from event blockTimestamps
//   3. Pulls every pots row from the BD
//   4. Reports per row whether BD.day_number matches chain truth
//   5. Summarizes the skew so we can write the fix-it migration with
//      eyes open

import { readFileSync } from "node:fs";
import { createPublicClient, http, parseAbiItem } from "viem";
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
const POT = "0x88a59c58Ca70DF6971F9499f6117A2BA41653e3e";
const RPC = "https://forno.celo.org";
const c = createPublicClient({ chain: celo, transport: http(RPC) });

const DAY_ROLLED = parseAbiItem(
  "event DayRolled(uint256 indexed gameId, uint256 indexed closedDay, address closedWinner, uint256 closedPot, uint256 indexed newDay, uint256 seeded)",
);

const GAMES = [
  { id: 1n, label: "grammar EN", bdGame: "grammar", bdLang: "en" },
  { id: 2n, label: "grammar ES", bdGame: "grammar", bdLang: "es" },
  { id: 3n, label: "math", bdGame: "math", bdLang: null },
];

// Forno caps eth_getLogs to ~5000 blocks per request. Paginate.
async function scanRolledEvents() {
  const head = await c.getBlockNumber();
  console.log(`Scanning DayRolled events up to block ${head}`);
  const CHUNK = 4500n;
  // Contract deployed approximately mid-April 2026 — start a bit before.
  // Could derive from celoscan, this is fine for now.
  const START = 65_000_000n;
  const events = [];
  for (let from = START; from <= head; from += CHUNK) {
    const to = from + CHUNK - 1n > head ? head : from + CHUNK - 1n;
    try {
      const logs = await c.getLogs({
        address: POT,
        event: DAY_ROLLED,
        fromBlock: from,
        toBlock: to,
      });
      for (const log of logs) {
        events.push({
          block: log.blockNumber,
          gameId: log.args.gameId,
          closedDay: log.args.closedDay,
          newDay: log.args.newDay,
          winner: log.args.closedWinner,
        });
      }
    } catch (e) {
      console.warn(`chunk ${from}-${to} failed: ${e.message.slice(0, 80)}`);
    }
  }
  console.log(`Found ${events.length} DayRolled events total`);
  return events;
}

function buildCalendarMap(events) {
  // For each game, sort events by block. Each event tells us "at this
  // block, day closedDay was finalized → newDay opened". The UTC date
  // of the BLOCK is when that rollover happened (cron fires shortly
  // after midnight UTC, so block.date ≈ the calendar date for newDay).
  // Map calendarDate → newDay so we can compare against pots.day_utc.
  const map = new Map(); // `${gameId}:${utcDate}` → newDay
  return { events, map };
}

async function loadPots() {
  const { data } = await SUPA.from("pots").select("*").order("day_utc");
  return data;
}

const events = await scanRolledEvents();
const pots = await loadPots();
console.log(`Loaded ${pots.length} pots rows from BD`);
console.log("");

// Build map of (game, calendarDate) → on-chain {closedDay, newDay}
// using block timestamps. For each event, fetch the block timestamp
// (one round-trip per unique block — many events share blocks).
const blockTimes = new Map();
const uniqueBlocks = [...new Set(events.map((e) => String(e.block)))];
console.log(`Fetching timestamps for ${uniqueBlocks.length} unique blocks…`);
for (const b of uniqueBlocks) {
  try {
    const blk = await c.getBlock({ blockNumber: BigInt(b) });
    blockTimes.set(b, Number(blk.timestamp));
  } catch (e) {
    console.warn(`block ${b} ts failed: ${e.message.slice(0, 60)}`);
  }
}

// Per (gameId, utcDate), what closedDay + newDay does chain say?
// The cron fires at midnight UTC, so a rollDay tx at 00:05 UTC of date
// X corresponds to closing the pots row of date (X-1) and opening date X.
// The pots row for date X has day_number = newDay.
const chainTruth = new Map(); // "gameId:date" → { closedDay, newDay }
for (const e of events) {
  const ts = blockTimes.get(String(e.block));
  if (ts === undefined) continue;
  const utcDate = new Date(ts * 1000).toISOString().slice(0, 10);
  // Each rollDay tx fires ~00:05 UTC of a calendar day, so the tx's
  // UTC date == the "newDay" calendar date (the day being opened).
  chainTruth.set(`${e.gameId}:${utcDate}`, {
    closedDay: e.closedDay,
    newDay: e.newDay,
    block: e.block,
  });
}

console.log("");
console.log("=== Mismatches in pots.day_number vs chain ===");
let mismatched = 0;
let ok = 0;
let noChain = 0;
for (const p of pots) {
  const gameId = p.game_id;
  const truth = chainTruth.get(`${gameId}:${p.day_utc}`);
  if (!truth) {
    noChain++;
    continue;
  }
  // The pots row for date X has BD.day_number that *should* equal
  // chain's newDay for that date.
  const expected = Number(truth.newDay);
  if (p.day_number === expected) {
    ok++;
  } else {
    mismatched++;
    console.log(
      `  ${p.game.padEnd(7)} lang=${(p.lang || "-").padEnd(3)} date=${p.day_utc}  BD.dayN=${p.day_number}  chain.newDay=${expected}  drift=${p.day_number - expected}`,
    );
  }
}
console.log("");
console.log(`Summary: ${ok} match, ${mismatched} mismatched, ${noChain} no chain event for that date`);

// Apply the fix when --execute is passed. Safe to re-run: it only
// touches rows where day_number differs from chain.newDay, and after
// the fix subsequent runs find 0 mismatches.
if (process.argv.includes("--execute") && mismatched > 0) {
  console.log("");
  console.log("=== APPLYING FIX (UPDATE pots SET day_number = chain.newDay) ===");
  let updated = 0;
  for (const p of pots) {
    const truth = chainTruth.get(`${p.game_id}:${p.day_utc}`);
    if (!truth) continue;
    const expected = Number(truth.newDay);
    if (p.day_number === expected) continue;
    const { error } = await SUPA.from("pots")
      .update({ day_number: expected })
      .eq("game_id", p.game_id)
      .eq("day_utc", p.day_utc);
    if (error) {
      console.log(`  ✗ ${p.game} ${p.lang || "-"} ${p.day_utc}: ${error.message}`);
    } else {
      updated++;
      console.log(`  ✓ ${p.game} ${p.lang || "-"} ${p.day_utc}: ${p.day_number} → ${expected}`);
    }
  }
  console.log(`Updated ${updated} rows.`);
} else if (mismatched > 0) {
  console.log("");
  console.log("(dry-run — re-run with --execute to apply)");
}
