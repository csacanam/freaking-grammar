// Manually run the same auto-fund logic the treasury-alert cron does,
// but from this machine against Forno — bypasses whatever has the
// production Alchemy URL stuck in 429-monthly-capacity-limit purgatory.
//
// Reads operator's USDT balance, water-fills it across the three games
// to equalize days-of-runway, approves the pot to spend USDT if needed,
// then issues one fundTreasury per game with the allocated amount.
//
// Dry-run by default; pass --execute to actually send the txs.
//
//   node scripts/fund-now.mjs
//   node scripts/fund-now.mjs --execute

import { readFileSync } from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbiItem,
  erc20Abi,
  formatUnits,
  maxUint256,
} from "viem";
import { celo } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

// Force Forno — Alchemy is rate-limited, that's why we're here.
const RPC = "https://forno.celo.org";
const POT = env.NEXT_PUBLIC_FREAKING_POT_CELO;
const USDT = "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e";
const PK = env.OPERATOR_PRIVATE_KEY;

if (!PK) {
  console.error("OPERATOR_PRIVATE_KEY missing from .env.local");
  process.exit(1);
}
if (!POT) {
  console.error("NEXT_PUBLIC_FREAKING_POT_CELO missing");
  process.exit(1);
}

const execute = process.argv.includes("--execute");

const POT_ABI = [
  parseAbiItem("function treasury(uint256 gameId) view returns (uint256)"),
  parseAbiItem("function dailySeed(uint256 gameId) view returns (uint256)"),
  parseAbiItem("function fundTreasury(uint256 gameId, uint256 amount)"),
];

const account = privateKeyToAccount(PK.startsWith("0x") ? PK : `0x${PK}`);
const pub = createPublicClient({ chain: celo, transport: http(RPC) });
const wallet = createWalletClient({ account, chain: celo, transport: http(RPC) });

console.log("Operator:", account.address);
console.log("Pot:     ", POT);
console.log("RPC:     ", RPC);
console.log("Mode:    ", execute ? "EXECUTE (will send txs)" : "DRY-RUN");
console.log("");

// --- Read state ---
const [usdtBal, celoBal] = await Promise.all([
  pub.readContract({
    address: USDT,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account.address],
  }),
  pub.getBalance({ address: account.address }),
]);
console.log("Operator CELO:", formatUnits(celoBal, 18));
console.log("Operator USDT:", formatUnits(usdtBal, 6));

if (usdtBal === 0n) {
  console.log("Nothing to fund. Operator has 0 USDT.");
  process.exit(0);
}

const GAMES = [
  { id: 1n, label: "Grammar EN" },
  { id: 2n, label: "Grammar ES" },
  { id: 3n, label: "Math" },
];

const states = await Promise.all(
  GAMES.map(async (g) => {
    const [treasury, dailySeed] = await Promise.all([
      pub.readContract({ address: POT, abi: POT_ABI, functionName: "treasury", args: [g.id] }),
      pub.readContract({ address: POT, abi: POT_ABI, functionName: "dailySeed", args: [g.id] }),
    ]);
    return { ...g, treasury, dailySeed };
  }),
);

console.log("");
console.log("Treasury state BEFORE:");
for (const s of states) {
  const t = Number(formatUnits(s.treasury, 6));
  const d = Number(formatUnits(s.dailySeed, 6));
  const runway = d > 0 ? (t / d).toFixed(1) : "n/a";
  console.log(`  ${s.label}: treasury ${t.toFixed(2)} USDT · seed ${d.toFixed(2)} USDT · runway ${runway}d`);
}

// --- Water-filling allocator (same logic as treasury-alert/route.ts) ---
function allocate(balance, st) {
  let active = st.slice();
  while (true) {
    if (active.length === 0) break;
    const totalSeed = active.reduce((s, g) => s + g.dailySeed, 0n);
    if (totalSeed === 0n) break;
    const totalLiq = balance + active.reduce((s, g) => s + g.treasury, 0n);
    const overfunded = active.filter(
      (g) => g.treasury * totalSeed > totalLiq * g.dailySeed,
    );
    if (overfunded.length === 0) break;
    const ids = new Set(overfunded.map((g) => g.id));
    active = active.filter((g) => !ids.has(g.id));
  }
  if (active.length === 0) return st.map((g) => ({ id: g.id, label: g.label, amount: 0n }));
  const totalSeed = active.reduce((s, g) => s + g.dailySeed, 0n);
  const totalLiq = balance + active.reduce((s, g) => s + g.treasury, 0n);
  const lastId = active[active.length - 1].id;
  const allocs = [];
  let assigned = 0n;
  for (const g of st) {
    if (!active.some((a) => a.id === g.id)) {
      allocs.push({ id: g.id, label: g.label, amount: 0n });
      continue;
    }
    if (g.id === lastId) {
      allocs.push({ id: g.id, label: g.label, amount: balance - assigned });
      continue;
    }
    const target = (totalLiq * g.dailySeed) / totalSeed;
    const amt = target > g.treasury ? target - g.treasury : 0n;
    allocs.push({ id: g.id, label: g.label, amount: amt });
    assigned += amt;
  }
  return allocs;
}

const allocs = allocate(usdtBal, states);
console.log("");
console.log("Allocation:");
for (const a of allocs) {
  console.log(`  ${a.label} (game ${a.id}): ${formatUnits(a.amount, 6)} USDT`);
}

if (!execute) {
  console.log("");
  console.log("(dry-run — re-run with --execute to actually send)");
  process.exit(0);
}

// --- Approve if needed ---
console.log("");
console.log("[1/?] Checking allowance...");
const allowance = await pub.readContract({
  address: USDT,
  abi: erc20Abi,
  functionName: "allowance",
  args: [account.address, POT],
});
if (allowance < usdtBal) {
  console.log("  allowance < balance, sending approve(maxUint256)...");
  const hash = await wallet.writeContract({
    address: USDT,
    abi: erc20Abi,
    functionName: "approve",
    args: [POT, maxUint256],
  });
  console.log("  approve tx:", hash);
  await pub.waitForTransactionReceipt({ hash });
  console.log("  ✓ approve confirmed");
} else {
  console.log("  allowance OK, skipping approve.");
}

// --- fundTreasury per game ---
for (let i = 0; i < allocs.length; i++) {
  const a = allocs[i];
  if (a.amount === 0n) continue;
  console.log("");
  console.log(`[${i + 2}/${allocs.length + 1}] fundTreasury(${a.id}, ${formatUnits(a.amount, 6)} USDT)`);
  const hash = await wallet.writeContract({
    address: POT,
    abi: POT_ABI,
    functionName: "fundTreasury",
    args: [a.id, a.amount],
  });
  console.log("  tx:", hash);
  await pub.waitForTransactionReceipt({ hash });
  console.log("  ✓ confirmed");
}

// --- Verify ---
console.log("");
console.log("Treasury state AFTER:");
for (const g of GAMES) {
  const [treasury, dailySeed] = await Promise.all([
    pub.readContract({ address: POT, abi: POT_ABI, functionName: "treasury", args: [g.id] }),
    pub.readContract({ address: POT, abi: POT_ABI, functionName: "dailySeed", args: [g.id] }),
  ]);
  const t = Number(formatUnits(treasury, 6));
  const d = Number(formatUnits(dailySeed, 6));
  const runway = d > 0 ? (t / d).toFixed(1) : "n/a";
  console.log(`  ${g.label}: treasury ${t.toFixed(2)} USDT · runway ${runway}d`);
}

const finalUsdt = await pub.readContract({
  address: USDT,
  abi: erc20Abi,
  functionName: "balanceOf",
  args: [account.address],
});
console.log("");
console.log("Operator USDT after:", formatUnits(finalUsdt, 6));
