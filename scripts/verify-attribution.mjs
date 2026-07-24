#!/usr/bin/env node
// Confirm a transaction carried our Celo ERC-8021 attribution suffix on-chain.
//
//   node scripts/verify-attribution.mjs 0x<txHash>
//
// Decodes the tail of the tx's calldata via the SDK. Prints the codes it
// found, or tells you the tx went out untagged. Run this once after the
// first deploy that ships attribution — a missing or wrong tag is the
// most common integration mistake and this is the only check that catches it.
//
// Reads NEXT_PUBLIC_CELO_RPC_URL if set (falls back to Forno). The expected
// code is read from NEXT_PUBLIC_CELO_ATTRIBUTION_TAG when present, so nothing
// app-specific is hardcoded here.

import { readFileSync } from "node:fs";
import { createPublicClient, http } from "viem";
import { celo } from "viem/chains";
import { verifyTx } from "@celo/attribution-tags";

// Minimal .env.local reader — this is a one-off ops script, not app code.
for (const file of [".env.local", ".env"]) {
  try {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // file absent — fine, fall through to real env
  }
}

const hash = process.argv[2];
if (!/^0x[0-9a-fA-F]{64}$/.test(hash ?? "")) {
  console.error("usage: node scripts/verify-attribution.mjs 0x<txHash>");
  process.exit(1);
}

const client = createPublicClient({
  chain: celo,
  transport: http(process.env.NEXT_PUBLIC_CELO_RPC_URL || undefined),
});

// verifyTx never throws — an RPC error and a genuinely untagged tx both come
// back null. Fetch the tx ourselves first so the two can't be confused: a
// silent RPC failure reported as "untagged" would send you chasing a bug in
// the integration that isn't there.
let tx;
try {
  tx = await client.getTransaction({ hash });
} catch (e) {
  console.error(`! could not fetch ${hash} — ${e.shortMessage ?? e.message}`);
  console.error("  Bad hash or RPC problem — not an attribution result.");
  process.exit(2);
}

const result = await verifyTx({ client, hash });

if (!result) {
  console.log(`✗ ${hash}`);
  console.log(`  Tx found (block ${tx.blockNumber}) but carries no ERC-8021 tag.`);
  console.log(`  calldata tail: ...${tx.input.slice(-64)}`);
  process.exit(1);
}

const expected = process.env.NEXT_PUBLIC_CELO_ATTRIBUTION_TAG;
console.log(`✓ ${hash}`);
console.log(`  codes:    ${result.codes.join(", ")}`);
console.log(`  schemaId: ${result.schemaId}`);

if (expected) {
  const ok = result.codes.includes(expected);
  console.log(`  expected ${expected}: ${ok ? "present" : "MISSING"}`);
  if (!ok) process.exit(1);
}
