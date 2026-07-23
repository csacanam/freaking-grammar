// Complete the math (game 3) roll that the roll-day cron failed to land
// at the 2026-07-22→07-23 UTC boundary (nonce collision on Forno — math
// is last in the EN→ES→MATH sequence and rollDayOnChain had no
// nonceManager, so a stale nonce rejected the math rollDay while grammar
// rolled fine). Symptom: chain math currentDay stuck at 76 (day 76 open,
// winner 0x0, pot ~16.5 USDT), BD 07-22 closed with winner 0x9c8b13ed but
// rolled_tx NULL, and 07-23 reusing day_number 76.
//
// This calls rollDay(3, winner) to close day 76 assigning the 07-22
// winner and open day 77, then reconciles the BD (07-22 rolled_tx, 07-23
// day_number). Read-only by default; pass --execute to send the tx.

import { readFileSync } from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbiItem,
  getAddress,
} from "viem";
import { celo } from "viem/chains";
import { privateKeyToAccount, nonceManager } from "viem/accounts";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split("\n")
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);

const POT = getAddress("0x88a59c58Ca70DF6971F9499f6117A2BA41653e3e");
const GAME_ID = 3n;
const WINNER = getAddress("0x9c8b13ed0a0ae00aabdb1b6a332d544a338fa09d");
const PREV_DAY = "2026-07-22"; // day 76 on chain, to be closed
const TODAY = "2026-07-23"; // to be reconciled to day 77

const ABI = [
  parseAbiItem("function rollDay(uint256 gameId, address winner)"),
  parseAbiItem("function currentDay(uint256) view returns (uint256)"),
  parseAbiItem("function winnerOf(uint256,uint256) view returns (address)"),
  parseAbiItem("function pot(uint256,uint256) view returns (uint256)"),
  parseAbiItem("function owner() view returns (address)"),
];

const pub = createPublicClient({ chain: celo, transport: http("https://forno.celo.org") });
const account = privateKeyToAccount(
  env.OPERATOR_PRIVATE_KEY.startsWith("0x") ? env.OPERATOR_PRIVATE_KEY : `0x${env.OPERATOR_PRIVATE_KEY}`,
  { nonceManager },
);
const wallet = createWalletClient({ account, chain: celo, transport: http("https://forno.celo.org") });
const supa = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

console.log("Math stuck-roll fix — 2026-07-22 (day 76)");
console.log("=========================================");
const owner = await pub.readContract({ address: POT, abi: ABI, functionName: "owner" });
console.log(`Operator: ${account.address}`);
console.log(`Owner:    ${owner}`);
if (account.address.toLowerCase() !== owner.toLowerCase()) {
  console.error("✗ Operator is not the contract owner — rollDay would revert. Aborting.");
  process.exit(1);
}

const [cur, wOf, potWei] = await Promise.all([
  pub.readContract({ address: POT, abi: ABI, functionName: "currentDay", args: [GAME_ID] }),
  pub.readContract({ address: POT, abi: ABI, functionName: "winnerOf", args: [GAME_ID, 76n] }),
  pub.readContract({ address: POT, abi: ABI, functionName: "pot", args: [GAME_ID, 76n] }),
]);
console.log(`\nchain currentDay(3)=${cur}  winnerOf(3,76)=${wOf}  pot(3,76)=${Number(potWei) / 1e6} USDT`);
if (Number(cur) !== 76) { console.error(`✗ currentDay is ${cur}, expected 76 — state changed, aborting to be safe.`); process.exit(1); }
if (wOf !== "0x0000000000000000000000000000000000000000") { console.error(`✗ day 76 already has winner ${wOf} — already rolled? Aborting.`); process.exit(1); }

// BD sanity: 07-22 closed, winner matches, rolled_tx null; wins row exists.
const { data: prevPot } = await supa.from("pots").select("*").eq("game_id", 3).eq("day_utc", PREV_DAY).maybeSingle();
console.log(`\nBD 07-22 pot: winner=${prevPot?.winner} closed=${prevPot?.closed} rolled_tx=${prevPot?.rolled_tx || "NULL"} amt=${prevPot?.amount_units / 1e6}`);
if (!prevPot || prevPot.winner?.toLowerCase() !== WINNER.toLowerCase()) { console.error("✗ BD 07-22 winner doesn't match — aborting."); process.exit(1); }
if (prevPot.rolled_tx) { console.error("✗ BD 07-22 already has rolled_tx — aborting."); process.exit(1); }
const { data: winRow } = await supa.from("wins").select("player,amount_units,claimed").eq("game_id", 3).eq("day_utc", PREV_DAY).ilike("player", WINNER.toLowerCase()).maybeSingle();
console.log(`BD wins row for winner: ${winRow ? JSON.stringify(winRow) : "(none — cron may not have inserted)"}`);

console.log(`\nPlan: rollDay(3, ${WINNER})  → closes day 76 (winner gets ${Number(potWei) / 1e6} USDT), opens day 77`);
console.log(`      then BD: 07-22.rolled_tx=<hash>, 07-23.day_number=77`);

if (!process.argv.includes("--execute")) {
  console.log("\nDry-run. Pass --execute to send the tx.");
  process.exit(0);
}

console.log("\n=== Executing rollDay ===");
let hash;
try {
  hash = await wallet.writeContract({ address: POT, abi: ABI, functionName: "rollDay", args: [GAME_ID, WINNER] });
  console.log(`  rollDay sent  tx=${hash}`);
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") { console.error(`  ✗ tx reverted: ${hash}`); process.exit(1); }
  console.log(`  ✓ confirmed`);
} catch (e) { console.error(`  ✗ tx failed: ${e.shortMessage || e.message}`); process.exit(1); }

const [newCur, newWinner] = await Promise.all([
  pub.readContract({ address: POT, abi: ABI, functionName: "currentDay", args: [GAME_ID] }),
  pub.readContract({ address: POT, abi: ABI, functionName: "winnerOf", args: [GAME_ID, 76n] }),
]);
console.log(`\nchain now: currentDay(3)=${newCur}  winnerOf(3,76)=${newWinner}`);

// Reconcile BD.
const { error: e1 } = await supa.from("pots").update({ rolled_tx: hash }).eq("game_id", 3).eq("day_utc", PREV_DAY);
console.log(e1 ? `  ✗ 07-22 rolled_tx update failed: ${e1.message}` : `  ✓ 07-22 rolled_tx set`);
const { error: e2 } = await supa.from("pots").update({ day_number: Number(newCur) }).eq("game_id", 3).eq("day_utc", TODAY);
console.log(e2 ? `  ✗ 07-23 day_number update failed: ${e2.message}` : `  ✓ 07-23 day_number → ${Number(newCur)}`);
console.log("\nDone.");
