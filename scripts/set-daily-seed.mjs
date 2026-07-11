// Change the per-game daily seed (the guaranteed USDT pulled from the
// treasury into each new day's pot at rollDay time) on the deployed
// FreakingPot contract. Owner-only tx; reuses the operator key from
// .env.local — owner and operator are the same address.
//
// Safe to run mid-day: setDailySeed only affects FUTURE rollDay calls.
// Today's already-seeded pots keep whatever they have (seedCurrentDay
// can only top a pot UP, never claw back), so nothing running stops.
//
// Usage:
//   node scripts/set-daily-seed.mjs 0.3        # all games → 0.3 USDT/day
//   node scripts/set-daily-seed.mjs 0.3 1 2    # only Grammar EN + ES
//
// Side effect to know about: the treasury-alert cron's auto-fund
// allocator targets runway proportional to dailySeed, so after this it
// will move less USDT into treasuries automatically. Nothing to do —
// existing treasury balances just last longer.

import { readFileSync } from "node:fs";
import { createWalletClient, createPublicClient, http, parseUnits, formatUnits } from "viem";
import { celo } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

// Read the operator key out of .env.local without dragging in a dotenv
// dependency.
const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const OPERATOR_PK = env.OPERATOR_PRIVATE_KEY;
const POT_ADDRESS = env.NEXT_PUBLIC_FREAKING_POT_CELO || "0x88a59c58Ca70DF6971F9499f6117A2BA41653e3e";
const RPC = env.NEXT_PUBLIC_CELO_RPC_URL || "https://forno.celo.org";

if (!OPERATOR_PK) {
  console.error("OPERATOR_PRIVATE_KEY missing from .env.local");
  process.exit(1);
}

const seedUsdt = process.argv[2];
if (!seedUsdt || isNaN(parseFloat(seedUsdt))) {
  console.error("Usage: node scripts/set-daily-seed.mjs <usdt-per-day> [gameId...]");
  process.exit(1);
}
const newSeed = parseUnits(seedUsdt, 6); // USDT has 6 decimals on Celo
const gameIds = process.argv.slice(3).length
  ? process.argv.slice(3).map((g) => BigInt(g))
  : [1n, 2n, 3n];

const ABI = [
  {
    type: "function",
    name: "setDailySeed",
    inputs: [
      { name: "gameId", type: "uint256" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "dailySeed",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
];

const account = privateKeyToAccount(
  OPERATOR_PK.startsWith("0x") ? OPERATOR_PK : `0x${OPERATOR_PK}`,
);
const wallet = createWalletClient({
  account,
  chain: celo,
  transport: http(RPC),
});
const pub = createPublicClient({ chain: celo, transport: http(RPC) });

console.log("Owner:   ", account.address);
console.log("Pot:     ", POT_ADDRESS);
console.log("New seed:", seedUsdt, "USDT/day per game");
console.log("");

for (const gameId of gameIds) {
  const current = await pub.readContract({
    address: POT_ADDRESS,
    abi: ABI,
    functionName: "dailySeed",
    args: [gameId],
  });
  if (current === newSeed) {
    console.log(`game ${gameId}: already ${seedUsdt} USDT — skipping`);
    continue;
  }
  console.log(
    `game ${gameId}: ${formatUnits(current, 6)} → ${seedUsdt} USDT — sending setDailySeed...`,
  );
  const hash = await wallet.writeContract({
    address: POT_ADDRESS,
    abi: ABI,
    functionName: "setDailySeed",
    args: [gameId, newSeed],
  });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  console.log(`  ✓ tx ${hash} (block ${receipt.blockNumber})`);
}

console.log("");
console.log("Done. Takes effect at the next 00:00 UTC rollDay; today's pots are untouched.");
