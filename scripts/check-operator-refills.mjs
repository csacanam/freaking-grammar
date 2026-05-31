// Operator <-> pot money-flow auditor. Read-only. Run when you've sent
// USDT to the operator and want to know whether the treasury-alert
// cron actually moved it on to the pot — or, more generally, when
// numbers in /stats or telegram don't match what you remember sending.
//
//   node scripts/check-operator-refills.mjs
//
// What it reports:
//   - Operator CELO + USDT balance NOW (so you see whether the
//     deposit landed and whether the cron has drained it yet).
//   - On-chain treasury + daily seed per game (1=Grammar EN,
//     2=Grammar ES, 3=Math) — same numbers /stats reads but pulled
//     directly via Forno (no app layer in the way).
//   - Last ~100k blocks of USDT Transfer logs both directions on
//     the operator. INCOMING are sponsor/treasurer deposits;
//     OUTGOING are auto-funds to the pot (the cron) plus any
//     manual sends. Pot-bound transfers are flagged "POT (treasury
//     fund)" for fast scanning.
//   - Decoded fundTreasury calls (same outgoing list filtered to
//     pot recipients, in chronological order).
//
// History: written 2026-05-31 to diagnose why a 90.99 USDT deposit
// to the operator wasn't reaching the pot. The audit showed the
// inbound deposit landed cleanly, the outbound to pot side was
// empty, and the operator balance hadn't budged in hours — that
// pointed at the treasury-alert cron, which turned out to be
// crashing because Alchemy had hit its monthly free-tier cap and
// celoClient.readContract was throwing on the resulting non-JSON
// 429 page. The fix (chain.ts CELO_TRANSPORT with Forno fallback,
// commit af4b203) and the manual top-up (scripts/fund-now.mjs)
// landed the same day. Keep this script around — the same
// debugging shape applies to any future "cron silently did
// nothing" incident.
//
// Forces Forno because the Alchemy URL in .env.local is the same
// one that ran out, and the audit fails to render numbers if you
// route it through that. Read-only, takes ~10s.

import { readFileSync } from "node:fs";
import {
  createPublicClient,
  http,
  formatUnits,
  parseAbiItem,
  decodeFunctionData,
} from "viem";
import { celo } from "viem/chains";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

// Forno first — Alchemy's free tier rate-limits on the eth_getLogs sweep
// below and returns an HTML "Monthly capacity..." page that viem can't parse.
const RPC = "https://forno.celo.org";
const OPERATOR = "0xC1DBCa75432E92c2D040E2867cEe75B94ff2A3cd";
const POT = env.NEXT_PUBLIC_FREAKING_POT_CELO;
const USDT = "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e";

const client = createPublicClient({ chain: celo, transport: http(RPC) });

const ERC20_ABI = [
  parseAbiItem("function balanceOf(address) view returns (uint256)"),
  parseAbiItem(
    "event Transfer(address indexed from, address indexed to, uint256 value)",
  ),
];

const POT_ABI = [
  parseAbiItem(
    "function treasury(uint256 gameId) view returns (uint256)",
  ),
  parseAbiItem(
    "function dailySeed(uint256 gameId) view returns (uint256)",
  ),
  parseAbiItem(
    "function fundTreasury(uint256 gameId, uint256 amount)",
  ),
];

console.log("Operator:", OPERATOR);
console.log("Pot:     ", POT);
console.log("USDT:    ", USDT);
console.log("");

// --- 1. Balances now ---
const [celoBal, usdtBal] = await Promise.all([
  client.getBalance({ address: OPERATOR }),
  client.readContract({
    address: USDT,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [OPERATOR],
  }),
]);
console.log("=== Operator balance NOW ===");
console.log(`  CELO: ${formatUnits(celoBal, 18)}`);
console.log(`  USDT: ${formatUnits(usdtBal, 6)}`);
console.log("");

// --- 2. Treasury state per game ---
console.log("=== Pot treasury per game ===");
for (const gameId of [1n, 2n, 3n]) {
  try {
    const [treasury, seed] = await Promise.all([
      client.readContract({
        address: POT,
        abi: POT_ABI,
        functionName: "treasury",
        args: [gameId],
      }),
      client.readContract({
        address: POT,
        abi: POT_ABI,
        functionName: "dailySeed",
        args: [gameId],
      }),
    ]);
    const treasuryUSDT = Number(formatUnits(treasury, 6));
    const seedUSDT = Number(formatUnits(seed, 6));
    const runway = seedUSDT > 0 ? (treasuryUSDT / seedUSDT).toFixed(1) : "n/a";
    const label = gameId === 1n ? "Grammar EN" : gameId === 2n ? "Grammar ES" : "Math";
    console.log(
      `  game ${gameId} (${label}): treasury ${treasuryUSDT.toFixed(2)} USDT · seed ${seedUSDT.toFixed(2)} USDT · runway ${runway} days`,
    );
  } catch (e) {
    console.log(`  game ${gameId}: read failed (${e.message})`);
  }
}
console.log("");

// --- 3. Recent USDT transfers to/from operator ---
// Scan the last ~20k blocks (~1 day on Celo's 1s blocks ≈ 86k, so ~20k = 5h).
// Bump if the deposit happened earlier.
const head = await client.getBlockNumber();
const lookback = 100_000n;
const fromBlock = head > lookback ? head - lookback : 0n;

console.log(`=== USDT Transfer logs over the last ${lookback} blocks ===`);
console.log(`  Range: ${fromBlock} → ${head}`);

const [incoming, outgoing] = await Promise.all([
  client.getLogs({
    address: USDT,
    event: ERC20_ABI[1],
    args: { to: OPERATOR },
    fromBlock,
    toBlock: head,
  }),
  client.getLogs({
    address: USDT,
    event: ERC20_ABI[1],
    args: { from: OPERATOR },
    fromBlock,
    toBlock: head,
  }),
]);

console.log("");
console.log(`=== INCOMING USDT to operator (last ${lookback} blocks): ${incoming.length} ===`);
for (const log of incoming.slice(-10)) {
  const blk = await client.getBlock({ blockNumber: log.blockNumber });
  const when = new Date(Number(blk.timestamp) * 1000).toISOString();
  console.log(
    `  ${when}  from ${log.args.from?.slice(0, 10)}…  ${formatUnits(log.args.value, 6)} USDT  tx ${log.transactionHash.slice(0, 12)}…`,
  );
}

console.log("");
console.log(`=== OUTGOING USDT from operator (last ${lookback} blocks): ${outgoing.length} ===`);
for (const log of outgoing.slice(-10)) {
  const blk = await client.getBlock({ blockNumber: log.blockNumber });
  const when = new Date(Number(blk.timestamp) * 1000).toISOString();
  const toLabel =
    log.args.to?.toLowerCase() === POT.toLowerCase()
      ? "POT (treasury fund)"
      : log.args.to?.slice(0, 10) + "…";
  console.log(
    `  ${when}  to ${toLabel}  ${formatUnits(log.args.value, 6)} USDT  tx ${log.transactionHash.slice(0, 12)}…`,
  );
}

// --- 4. Decode any fundTreasury txs from operator → pot ---
console.log("");
console.log("=== fundTreasury calls from operator (last 10 from above) ===");
const fundLogs = outgoing.filter(
  (l) => l.args.to?.toLowerCase() === POT.toLowerCase(),
);
if (fundLogs.length === 0) {
  console.log("  (none — operator hasn't sent USDT to the pot in window)");
} else {
  for (const log of fundLogs.slice(-10)) {
    const tx = await client.getTransaction({ hash: log.transactionHash });
    const blk = await client.getBlock({ blockNumber: log.blockNumber });
    const when = new Date(Number(blk.timestamp) * 1000).toISOString();
    // The actual fundTreasury call is in the parent tx (USDT.transferFrom
    // is what we see in the event). Just show the parent tx + amount.
    console.log(
      `  ${when}  ${formatUnits(log.args.value, 6)} USDT  tx ${tx.hash.slice(0, 18)}…`,
    );
  }
}
