// One-shot script to initialize Freaking Math (gameId=3) on the existing
// FreakingPot contract. Reuses the operator key from .env.local — the
// contract's owner and operator are the same address (verified via
// `node check-owner.mjs`). After this runs, plays for gameId=3 work
// normally and the daily cron will pick up the Math pot like any other.
//
// Usage:
//   node scripts/init-math.mjs            # default 1 USDT/day seed
//   node scripts/init-math.mjs 0          # 0 seed (no daily auto-fund)
//   node scripts/init-math.mjs 2.5        # 2.5 USDT/day seed
//
// dailySeed is the per-day USDT pulled from `treasury[3]` into the
// pot at rollDay() time. Match Grammar's 1 USDT default unless you
// want Math to pay differently.

import { readFileSync } from "node:fs";
import { createWalletClient, createPublicClient, http, parseUnits } from "viem";
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

const seedUsdt = process.argv[2] ?? "1";
const dailySeed = parseUnits(seedUsdt, 6); // USDT has 6 decimals on Celo

const ABI = [
  {
    type: "function",
    name: "initGame",
    inputs: [
      { name: "gameId", type: "uint256" },
      { name: "_dailySeed", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "currentDay",
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

console.log("Owner:        ", account.address);
console.log("Pot:          ", POT_ADDRESS);
console.log("gameId:       3 (Math)");
console.log("dailySeed:    ", seedUsdt, "USDT");

// Sanity: bail if game 3 already initialized (currentDay > 0).
const day = await pub.readContract({
  address: POT_ADDRESS,
  abi: ABI,
  functionName: "currentDay",
  args: [3n],
});
if (Number(day) > 0) {
  console.error(`✗ Math (gameId=3) already initialized — currentDay=${day}.`);
  process.exit(1);
}

console.log("");
console.log("Calling initGame(3, dailySeed)...");
const hash = await wallet.writeContract({
  address: POT_ADDRESS,
  abi: ABI,
  functionName: "initGame",
  args: [3n, dailySeed],
});
console.log("tx:", hash);
const receipt = await pub.waitForTransactionReceipt({ hash });
console.log("✓ confirmed in block", receipt.blockNumber);

const newDay = await pub.readContract({
  address: POT_ADDRESS,
  abi: ABI,
  functionName: "currentDay",
  args: [3n],
});
console.log("currentDay[3] is now:", newDay);
console.log("");
console.log("Math is live on-chain. Visit /math in the app to start playing.");
