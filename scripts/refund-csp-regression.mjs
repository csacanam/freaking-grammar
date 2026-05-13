// Manually compensate Privy users who signed up during the CSP-vs-Turnstile
// regression window (2026-05-11 04:23 UTC → CSP fix deploy). Those users hit
// /welcome-gas behind an iframe-blocked Turnstile widget, so WelcomeGasBridge
// stayed pegged waiting for a token that never arrived — no row was written
// to welcome_airdrops, no CELO was sent.
//
// What this does, per address:
//   1. Skip if welcome_airdrops already has a row (idempotent).
//   2. Skip if on-chain balance ≥ 0.005 CELO (already funded somehow).
//   3. Send 0.1 CELO from operator (same amount the live endpoint sends).
//   4. Insert into welcome_airdrops so /api/welcome-gas treats it as
//      already-airdropped on future hits, and the user lands in daily-email
//      eligibility like everyone else.
//
// Dry-run by default. Pass --execute to actually send.
//
// Usage:
//   # one-off
//   node scripts/refund-csp-regression.mjs 0xabc... 0xdef...
//
//   # from a JSON export from Privy: [{"address":"0x..","email":"a@b.c","lang":"en"},...]
//   node scripts/refund-csp-regression.mjs --file affected.json
//
//   # actually send
//   node scripts/refund-csp-regression.mjs --execute --file affected.json

import { readFileSync } from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  formatEther,
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

const PK = env.OPERATOR_PRIVATE_KEY;
const RPC = env.NEXT_PUBLIC_CELO_RPC_URL || "https://forno.celo.org";
const SUPA_URL = env.SUPABASE_URL;
const SUPA_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

if (!PK || !SUPA_URL || !SUPA_KEY) {
  console.error("Missing env (OPERATOR_PRIVATE_KEY / SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).");
  process.exit(1);
}

const AIRDROP_WEI = parseEther("0.1");
const SKIP_BALANCE_WEI = parseEther("0.005");

// --- args ---
const argv = process.argv.slice(2);
const execute = argv.includes("--execute");
const fileIdx = argv.indexOf("--file");
const filePath = fileIdx >= 0 ? argv[fileIdx + 1] : null;

let entries = [];
if (filePath) {
  const raw = JSON.parse(readFileSync(filePath, "utf8"));
  if (!Array.isArray(raw)) {
    console.error("--file must contain a JSON array of {address, email?, lang?} objects.");
    process.exit(1);
  }
  entries = raw;
}
for (const a of argv) {
  if (a.startsWith("0x") && /^0x[0-9a-fA-F]{40}$/.test(a)) {
    entries.push({ address: a });
  }
}
if (entries.length === 0) {
  console.error("No addresses provided. Pass 0x... args or --file <path>.");
  process.exit(1);
}

// Normalize, dedupe.
const seen = new Set();
const normalized = [];
for (const e of entries) {
  const addr = (e.address || "").toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(addr)) {
    console.warn("Skipping malformed address:", e.address);
    continue;
  }
  if (seen.has(addr)) continue;
  seen.add(addr);
  normalized.push({
    address: addr,
    email: e.email ?? null,
    lang: e.lang === "en" || e.lang === "es" ? e.lang : null,
  });
}

const account = privateKeyToAccount(PK.startsWith("0x") ? PK : `0x${PK}`);
const pub = createPublicClient({ chain: celo, transport: http(RPC) });
const wallet = createWalletClient({ account, chain: celo, transport: http(RPC) });
const supa = createClient(SUPA_URL, SUPA_KEY);

console.log("Operator:    ", account.address);
console.log("Mode:        ", execute ? "EXECUTE (will send CELO)" : "DRY-RUN");
console.log("Candidates:  ", normalized.length);
console.log("");

// Pre-flight: operator balance
const opBal = await pub.getBalance({ address: account.address });
console.log("Operator CELO balance:", formatEther(opBal));
if (opBal < AIRDROP_WEI * BigInt(normalized.length)) {
  console.warn(
    `⚠ Operator may not have enough CELO. Need ~${formatEther(AIRDROP_WEI * BigInt(normalized.length))}, have ${formatEther(opBal)}.`,
  );
}
console.log("");

let sent = 0;
let skippedExisting = 0;
let skippedFunded = 0;
let failed = 0;

for (const { address, email, lang } of normalized) {
  // 1. Idempotency check vs welcome_airdrops.
  const { data: existing, error: lookupErr } = await supa
    .from("welcome_airdrops")
    .select("address,tx_hash")
    .eq("address", address)
    .maybeSingle();
  if (lookupErr) {
    console.error(`${address}  lookup-error  ${lookupErr.message}`);
    failed++;
    continue;
  }
  if (existing) {
    console.log(`${address}  skip:already-airdropped  tx=${existing.tx_hash ?? "(null)"}`);
    skippedExisting++;
    continue;
  }

  // 2. Balance check.
  const bal = await pub.getBalance({ address }).catch(() => 0n);
  if (bal >= SKIP_BALANCE_WEI) {
    console.log(`${address}  skip:already-funded  bal=${formatEther(bal)} CELO`);
    skippedFunded++;
    continue;
  }

  if (!execute) {
    console.log(`${address}  would-send  0.1 CELO  email=${email ?? "-"}`);
    continue;
  }

  // 3. Send.
  try {
    const txHash = await wallet.sendTransaction({
      to: address,
      value: AIRDROP_WEI,
    });
    await pub.waitForTransactionReceipt({ hash: txHash });

    const { error: insertErr } = await supa.from("welcome_airdrops").insert({
      address,
      email,
      lang,
      amount_wei: AIRDROP_WEI.toString(),
      tx_hash: txHash,
    });
    if (insertErr) {
      console.error(`${address}  sent-but-insert-failed  tx=${txHash}  ${insertErr.message}`);
    } else {
      console.log(`${address}  sent  tx=${txHash}`);
    }
    sent++;
  } catch (e) {
    console.error(`${address}  send-failed  ${e.message}`);
    failed++;
  }
}

console.log("");
console.log("=== summary ===");
console.log("sent:                ", sent);
console.log("skipped (in DB):     ", skippedExisting);
console.log("skipped (funded):    ", skippedFunded);
console.log("failed:              ", failed);
if (!execute) console.log("(dry-run — re-run with --execute to actually send)");
