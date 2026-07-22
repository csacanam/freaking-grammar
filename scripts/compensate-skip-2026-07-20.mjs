// Compensate the single player whose 2026-07-20 grammar/ES prize was
// lost on chain when the rollDay cron skipped that calendar day.
//
// Background (see scripts/private/skew-scan.mjs output):
//   - 2026-07-20 grammar/ES: 0x4424… was the top scorer (score 4) and
//     the BD recorded them as winner of day_number 91, but the day was
//     NEVER rolled on chain (pots.rolled_tx = NULL). The chain jumped
//     from #90 (07-19) straight to #91 (07-21), so on chain day #91's
//     winner is 0x8e57… (the 07-21 winner) — a DIFFERENT person.
//   - Result: 0x4424 has a BD wins row that points at a claim which
//     reverts with NotWinner. Their 0.3 USDT rolled into 07-21's pot.
//   - This is the ONLY uncompensated skew victim (the three 2026-05-30
//     rows in skew-scan were already paid via compensate-outage-2026-05-31).
//
// Fix: pay 0.3 USDT from game 2's own on-chain treasury via owner-only
// withdrawTreasury(), then UPDATE the existing wins row to claimed=true
// with claim_tx pointing at the compensation tx. Chain stays clean — no
// phantom claim, no override. Day #91 on chain is left as-is (it
// belongs to the legit 07-21 winner 0x8e57, who can still claim it).
//
// Read-only by default. Pass --execute to send the tx + update BD.

import { readFileSync } from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbiItem,
  getAddress,
} from "viem";
import { celo } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
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

const POT = getAddress("0x88a59c58Ca70DF6971F9499f6117A2BA41653e3e");

// The single affected player — top scorer, grammar/ES, 2026-07-20.
const COMP = {
  gameId: 2,
  game: "grammar",
  gameLabel: "grammar ES",
  lang: "es",
  dayUtc: "2026-07-20",
  dayNumber: 91,
  recipient: getAddress("0x4424DC24C32dcAa4ACaDBf92Fc8A69bC11c0f07E"),
  amount: 300_000n, // 0.3 USDT — the 07-20 pot they should have won
};

const POT_ABI = [
  parseAbiItem("function withdrawTreasury(uint256 gameId, uint256 amount, address to)"),
  parseAbiItem("function treasury(uint256) view returns (uint256)"),
  parseAbiItem("function owner() view returns (address)"),
];

const pub = createPublicClient({ chain: celo, transport: http("https://forno.celo.org") });
const account = privateKeyToAccount(
  env.OPERATOR_PRIVATE_KEY.startsWith("0x") ? env.OPERATOR_PRIVATE_KEY : `0x${env.OPERATOR_PRIVATE_KEY}`,
);
const wallet = createWalletClient({ account, chain: celo, transport: http("https://forno.celo.org") });
const supa = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

console.log("Compensation plan — 2026-07-20 grammar/ES skip");
console.log("==============================================");
console.log(`Owner wallet:    ${account.address}`);
const onchainOwner = await pub.readContract({ address: POT, abi: POT_ABI, functionName: "owner" });
console.log(`Contract owner:  ${onchainOwner}`);
if (account.address.toLowerCase() !== onchainOwner.toLowerCase()) {
  console.error("✗ Loaded wallet is NOT the contract owner — withdrawTreasury would revert. Aborting.");
  process.exit(1);
}

// Safety: confirm the BD wins row exists, is unclaimed, and hasn't
// already been compensated.
const { data: winRow, error: winErr } = await supa
  .from("wins")
  .select("*")
  .eq("game_id", COMP.gameId)
  .eq("day_utc", COMP.dayUtc)
  .ilike("player", COMP.recipient.toLowerCase())
  .maybeSingle();
if (winErr) { console.error(`✗ BD read failed: ${winErr.message}`); process.exit(1); }
if (!winRow) { console.error("✗ No BD wins row for this player/day — aborting (unexpected)."); process.exit(1); }
if (winRow.claimed || winRow.claim_tx) {
  console.error(`✗ wins row already claimed/compensated (claimed=${winRow.claimed}, claim_tx=${winRow.claim_tx}). Aborting.`);
  process.exit(1);
}
if (Number(winRow.amount_units) !== Number(COMP.amount)) {
  console.error(`✗ amount mismatch: BD row says ${winRow.amount_units}, script says ${COMP.amount}. Aborting.`);
  process.exit(1);
}
console.log(`BD wins row:     found, claimed=false, amount=${Number(winRow.amount_units) / 1e6} USDT ✓`);

const treas = await pub.readContract({ address: POT, abi: POT_ABI, functionName: "treasury", args: [BigInt(COMP.gameId)] });
const ok = treas >= COMP.amount;
console.log(`\n  game=${COMP.gameLabel} → ${COMP.recipient}`);
console.log(`  amount: ${Number(COMP.amount) / 1e6} USDT   treasury(${COMP.gameId}) before: ${Number(treas) / 1e6} USDT  ${ok ? "✓" : "✗ INSUFFICIENT"}`);
if (!ok) { console.error("  Aborting — treasury too low."); process.exit(1); }

if (!process.argv.includes("--execute")) {
  console.log("\nDry-run. Pass --execute to send the tx and update the BD wins row.");
  process.exit(0);
}

console.log("\n=== Sending tx + updating BD wins row ===");
let hash;
try {
  hash = await wallet.writeContract({
    address: POT, abi: POT_ABI, functionName: "withdrawTreasury",
    args: [BigInt(COMP.gameId), COMP.amount, COMP.recipient],
  });
  console.log(`  ✓ withdrawTreasury sent  tx=${hash}`);
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") { console.error(`  ✗ tx reverted: ${hash}`); process.exit(1); }
  console.log(`  ✓ tx confirmed`);
} catch (e) {
  console.error(`  ✗ tx failed: ${e.shortMessage || e.message}`);
  process.exit(1);
}

// UPDATE (not insert) the existing wins row → claimed=true + claim_tx.
const { error: updErr } = await supa
  .from("wins")
  .update({ claimed: true, claim_tx: hash })
  .eq("game_id", COMP.gameId)
  .eq("day_utc", COMP.dayUtc)
  .ilike("player", COMP.recipient.toLowerCase());
if (updErr) {
  console.error(`  ✗ BD update failed: ${updErr.message}`);
  console.error(`    (tx ALREADY sent ${hash} — update wins row manually: claimed=true, claim_tx=${hash})`);
  process.exit(1);
}
console.log(`  ✓ BD wins row updated (claimed=true, claim_tx=${hash})`);

const treasAfter = await pub.readContract({ address: POT, abi: POT_ABI, functionName: "treasury", args: [BigInt(COMP.gameId)] });
console.log(`\nDone. treasury(${COMP.gameId}) now: ${Number(treasAfter) / 1e6} USDT`);
