// Compensate the 3 players whose 2026-05-30 prizes were lost on chain
// during the 2026-05-31 Alchemy outage.
//
// Background:
//   - On 2026-05-31 the rollDay cron failed for all 3 games (Alchemy 429).
//   - When rollDay finally fired (on 2026-06-01) the cron passed
//     winner=0x0 because it computed from the wrong calendar date.
//   - Result: each of the 3 affected days closed on chain with no
//     winner. The pot rolled into the next day's seed and the players
//     who legitimately won that day got nothing.
//
// Fix: pay the 3 affected players what they should have won, taking
// from each game's own on-chain treasury (the bucket those funds
// would have come from anyway). Uses owner-only withdrawTreasury().
// Contract state stays clean — no phantom claims, no overrides.
//
// Read-only by default. Pass --execute to send the txs.

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
const FEE_CURRENCY_USDT = "0x0e2a3e05bc9a16f5292a6170456a710cb89c6f72"; // CIP-64

// Real winners — top scorers in the runs table on 2026-05-30. (The
// earlier wins-table fix had inserted the *chain* winners of the
// day_number-mismatched days, which were the winners of OTHER days —
// not the people who actually won 2026-05-30. Those rows were deleted
// in audit-wins-chain-sync.mjs --execute. This list is the truth.)
const COMPENSATIONS = [
  {
    gameId: 1,
    game: "grammar",
    gameLabel: "grammar EN",
    lang: "en",
    recipient: getAddress("0x1fc12811Ea4cCB575a0f5f6A37e678bd4d98508c"),
    amount: 1_160_000n, // 1.16 USDT — score=18
  },
  {
    gameId: 2,
    game: "grammar",
    gameLabel: "grammar ES",
    lang: "es",
    recipient: getAddress("0x59A771735562028c46fec642195be22e27Ab9f8f"),
    amount: 1_160_000n, // 1.16 USDT — score=24
  },
  {
    gameId: 3,
    game: "math",
    gameLabel: "math",
    lang: null,
    recipient: getAddress("0x1fc12811Ea4cCB575a0f5f6A37e678bd4d98508c"),
    amount: 1_080_000n, // 1.08 USDT — score=16  (same wallet won EN+math)
  },
];

const DAY_UTC = "2026-05-30";

const POT_ABI = [
  parseAbiItem(
    "function withdrawTreasury(uint256 gameId, uint256 amount, address to)",
  ),
  parseAbiItem("function treasury(uint256) view returns (uint256)"),
  parseAbiItem("function owner() view returns (address)"),
];

const pub = createPublicClient({
  chain: celo,
  transport: http("https://forno.celo.org"),
});

const account = privateKeyToAccount(
  env.OPERATOR_PRIVATE_KEY.startsWith("0x")
    ? env.OPERATOR_PRIVATE_KEY
    : `0x${env.OPERATOR_PRIVATE_KEY}`,
);

const wallet = createWalletClient({
  account,
  chain: celo,
  transport: http("https://forno.celo.org"),
});

console.log("Compensation plan");
console.log("=================");
console.log(`Owner wallet:    ${account.address}`);
const onchainOwner = await pub.readContract({
  address: POT,
  abi: POT_ABI,
  functionName: "owner",
});
console.log(`Contract owner:  ${onchainOwner}`);
if (account.address.toLowerCase() !== onchainOwner.toLowerCase()) {
  console.error(
    "✗ Loaded wallet is NOT the contract owner — withdrawTreasury would revert. Aborting.",
  );
  process.exit(1);
}
console.log("");

let totalUsdt = 0n;
for (const c of COMPENSATIONS) {
  const treas = await pub.readContract({
    address: POT,
    abi: POT_ABI,
    functionName: "treasury",
    args: [BigInt(c.gameId)],
  });
  const ok = treas >= c.amount;
  console.log(
    `  game=${c.gameLabel.padEnd(11)} → ${c.recipient}  ${Number(c.amount) / 1e6} USDT   treasury before: ${Number(treas) / 1e6} USDT  ${ok ? "✓" : "✗ INSUFFICIENT"}`,
  );
  if (!ok) {
    console.error("  Aborting — treasury too low.");
    process.exit(1);
  }
  totalUsdt += c.amount;
}
console.log("");
console.log(`Total to disburse: ${Number(totalUsdt) / 1e6} USDT`);
console.log("");

if (!process.argv.includes("--execute")) {
  console.log("Dry-run. Pass --execute to send the txs.");
  process.exit(0);
}

const supa = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

console.log("=== Sending txs + inserting BD wins rows ===");
for (const c of COMPENSATIONS) {
  let hash;
  try {
    hash = await wallet.writeContract({
      address: POT,
      abi: POT_ABI,
      functionName: "withdrawTreasury",
      args: [BigInt(c.gameId), c.amount, c.recipient],
    });
    console.log(
      `  ✓ ${c.gameLabel.padEnd(11)} → ${c.recipient.slice(0, 12)}…  tx=${hash}`,
    );
    const receipt = await pub.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      console.error(`    ✗ tx reverted: ${hash}`);
      process.exit(1);
    }
  } catch (e) {
    console.error(`  ✗ ${c.gameLabel}: ${e.shortMessage || e.message}`);
    process.exit(1);
  }

  // Insert the wins row with claimed=true + claim_tx pointing at the
  // compensation tx. /you's unclaimed list filters claimed=false so it
  // won't surface a claim button; stats sums all amount_units so the
  // wins count and totalEarned reflect the player's true history.
  const { error: insErr } = await supa.from("wins").insert({
    game: c.game,
    game_id: c.gameId,
    lang: c.lang,
    day_utc: DAY_UTC,
    player: c.recipient.toLowerCase(),
    amount_units: Number(c.amount),
    claimed: true,
    claim_tx: hash,
  });
  if (insErr) {
    console.error(`    ✗ BD insert failed for ${c.gameLabel}: ${insErr.message}`);
    console.error(`      (tx already sent — needs manual BD insert)`);
    process.exit(1);
  }
  console.log(`    ✓ BD wins row inserted (claimed=true, claim_tx=${hash.slice(0, 14)}…)`);
}

console.log("");
console.log("All 3 compensations sent. Final state:");
for (const c of COMPENSATIONS) {
  const treas = await pub.readContract({
    address: POT,
    abi: POT_ABI,
    functionName: "treasury",
    args: [BigInt(c.gameId)],
  });
  console.log(`  game=${c.gameLabel.padEnd(11)} treasury now: ${Number(treas) / 1e6} USDT`);
}
