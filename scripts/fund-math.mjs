// Fund Math's treasury + seed today's pot.
//
// `initGame(3, dailySeed)` already configured Math, but the contract's
// `treasury[3]` starts at 0 — there's no USDT to pull from when the
// daily seed fires. This script:
//   1. Checks operator's USDT balance
//   2. Approves USDT spend from operator → pot contract (one-time)
//   3. fundTreasury(3, amount) — moves USDT into treasury[3]
//   4. seedCurrentDay(3) — pulls 1 USDT from treasury[3] into today's
//      pot. Daily auto-seeding happens via the rollDay() cron from
//      day 2 onward, but day 1 has no previous day to roll, so we
//      seed it manually here.
//
// Usage:
//   node scripts/fund-math.mjs           # default 30 USDT (~30 days)
//   node scripts/fund-math.mjs 10        # 10 USDT (~10 days)

import { readFileSync } from "node:fs";
import {
  createWalletClient,
  createPublicClient,
  http,
  parseUnits,
  formatUnits,
  erc20Abi,
} from "viem";
import { celo } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const PK = env.OPERATOR_PRIVATE_KEY;
const POT = env.NEXT_PUBLIC_FREAKING_POT_CELO || "0x88a59c58Ca70DF6971F9499f6117A2BA41653e3e";
const USDT = "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e"; // Celo mainnet USDT
const RPC = env.NEXT_PUBLIC_CELO_RPC_URL || "https://forno.celo.org";

if (!PK) {
  console.error("OPERATOR_PRIVATE_KEY missing from .env.local");
  process.exit(1);
}

const fundAmountUsdt = process.argv[2] ?? "30";
const amount = parseUnits(fundAmountUsdt, 6); // USDT has 6 decimals on Celo

const POT_ABI = [
  {
    type: "function",
    name: "fundTreasury",
    inputs: [
      { name: "gameId", type: "uint256" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "seedCurrentDay",
    inputs: [{ name: "gameId", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "treasury",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "viewPot",
    inputs: [
      { name: "", type: "uint256" },
      { name: "", type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "currentDay",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
];

const account = privateKeyToAccount(PK.startsWith("0x") ? PK : `0x${PK}`);
const wallet = createWalletClient({
  account,
  chain: celo,
  transport: http(RPC),
});
const pub = createPublicClient({ chain: celo, transport: http(RPC) });

console.log("Operator:        ", account.address);
console.log("Pot contract:    ", POT);
console.log("Funding amount:  ", fundAmountUsdt, "USDT");
console.log("");

// Sanity: have we got the USDT?
const balance = await pub.readContract({
  address: USDT,
  abi: erc20Abi,
  functionName: "balanceOf",
  args: [account.address],
});
console.log("Operator USDT balance:", formatUnits(balance, 6));
if (balance < amount) {
  console.error(`✗ Not enough USDT. Need ${fundAmountUsdt}, have ${formatUnits(balance, 6)}.`);
  process.exit(1);
}

// 1. Approve USDT → pot contract.
console.log("");
console.log("[1/3] Approving USDT spend...");
const approveHash = await wallet.writeContract({
  address: USDT,
  abi: erc20Abi,
  functionName: "approve",
  args: [POT, amount],
});
console.log("  tx:", approveHash);
await pub.waitForTransactionReceipt({ hash: approveHash });
console.log("  ✓ confirmed");

// 2. fundTreasury(3, amount).
console.log("");
console.log("[2/3] Funding treasury[3]...");
const fundHash = await wallet.writeContract({
  address: POT,
  abi: POT_ABI,
  functionName: "fundTreasury",
  args: [3n, amount],
});
console.log("  tx:", fundHash);
await pub.waitForTransactionReceipt({ hash: fundHash });
console.log("  ✓ confirmed");

// 3. seedCurrentDay(3) — pull dailySeed into today's pot.
console.log("");
console.log("[3/3] Seeding today's Math pot...");
const seedHash = await wallet.writeContract({
  address: POT,
  abi: POT_ABI,
  functionName: "seedCurrentDay",
  args: [3n],
});
console.log("  tx:", seedHash);
await pub.waitForTransactionReceipt({ hash: seedHash });
console.log("  ✓ confirmed");

// Final state check.
const day = await pub.readContract({
  address: POT,
  abi: POT_ABI,
  functionName: "currentDay",
  args: [3n],
});
const treasury = await pub.readContract({
  address: POT,
  abi: POT_ABI,
  functionName: "treasury",
  args: [3n],
});
const pot = await pub.readContract({
  address: POT,
  abi: POT_ABI,
  functionName: "viewPot",
  args: [3n, day],
});

console.log("");
console.log("=== Math state on-chain ===");
console.log("currentDay[3]: ", day);
console.log("treasury[3]:   ", formatUnits(treasury, 6), "USDT");
console.log(`viewPot[3][${day}]: `, formatUnits(pot, 6), "USDT");
console.log("");
console.log("Math pot is funded. Reload /math — the lobby should show",
  formatUnits(pot, 6), "USDT.");
