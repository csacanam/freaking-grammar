// Discover Privy users who signed up during the CSP-vs-Turnstile regression
// window (CSP frame-src didn't allow challenges.cloudflare.com, so the
// invisible Turnstile widget never rendered, the token callback never fired,
// and WelcomeGasBridge stayed pegged — no row written, no CELO sent).
//
// Strategy: page through Privy's /api/v1/users, keep ones created after the
// last successful welcome_airdrops insert (2026-05-11 04:23:45 UTC), pull
// their Privy embedded wallet address + email, and cross-check against
// welcome_airdrops in Supabase. The diff is the victim list, written to
// affected.json for refund-csp-regression.mjs to consume.

import { readFileSync, writeFileSync } from "node:fs";
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

const APP_ID = env.NEXT_PUBLIC_PRIVY_APP_ID;
const APP_SECRET = env.PRIVY_APP_SECRET;
const SUPA_URL = env.SUPABASE_URL;
const SUPA_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

if (!APP_ID || !APP_SECRET || !SUPA_URL || !SUPA_KEY) {
  console.error(
    "Missing env (NEXT_PUBLIC_PRIVY_APP_ID / PRIVY_APP_SECRET / SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).",
  );
  process.exit(1);
}

// Last good airdrop = 2026-05-11T04:23:45 UTC. Anyone newer than this is in
// the regression window. Override via CLI for a different cutoff.
const CUTOFF_ISO = process.argv[2] ?? "2026-05-11T04:23:45Z";
const CUTOFF_UNIX = Math.floor(new Date(CUTOFF_ISO).getTime() / 1000);
const OUT = process.argv[3] ?? "affected.json";

console.log("Cutoff (UTC):", CUTOFF_ISO, "→ unix", CUTOFF_UNIX);
console.log("Output:      ", OUT);
console.log("");

const supa = createClient(SUPA_URL, SUPA_KEY);
const authHeader = "Basic " + Buffer.from(`${APP_ID}:${APP_SECRET}`).toString("base64");

// --- Pull every welcome_airdrops address in one shot. There's <1k rows so
// no pagination concerns. Stash in a Set for O(1) lookup below.
const { data: airdrops, error: aErr } = await supa
  .from("welcome_airdrops")
  .select("address");
if (aErr) {
  console.error("Supabase error:", aErr.message);
  process.exit(1);
}
const airdroppedAddrs = new Set(airdrops.map((r) => r.address.toLowerCase()));
console.log("welcome_airdrops rows:", airdroppedAddrs.size);
console.log("");

// --- Page through Privy users.
let cursor = null;
let totalSeen = 0;
let postCutoff = 0;
const candidates = []; // { address, email, lang, privy_id, created_at_iso }

while (true) {
  const url = new URL("https://auth.privy.io/api/v1/users");
  url.searchParams.set("limit", "100");
  if (cursor) url.searchParams.set("cursor", cursor);

  const res = await fetch(url, {
    headers: {
      Authorization: authHeader,
      "privy-app-id": APP_ID,
    },
  });
  if (!res.ok) {
    console.error("Privy API error:", res.status, await res.text());
    process.exit(1);
  }
  const body = await res.json();
  const users = body.data ?? [];
  totalSeen += users.length;

  for (const u of users) {
    if (u.created_at <= CUTOFF_UNIX) continue;
    postCutoff++;

    const accounts = u.linked_accounts ?? [];
    // Privy embedded wallet: wallet_client_type === 'privy', chain_type === 'ethereum'.
    const embedded = accounts.find(
      (a) =>
        a.type === "wallet" &&
        a.wallet_client_type === "privy" &&
        a.chain_type === "ethereum",
    );
    if (!embedded) continue; // self-custody user (MetaMask etc.) — not eligible
    const emailAcc = accounts.find((a) => a.type === "email");
    const address = embedded.address?.toLowerCase();
    if (!address) continue;

    if (airdroppedAddrs.has(address)) continue; // already compensated/airdropped

    candidates.push({
      address,
      email: emailAcc?.address ?? null,
      lang: null, // unknown — refund script will leave it null
      privy_id: u.id,
      created_at_iso: new Date(u.created_at * 1000).toISOString(),
    });
  }

  cursor = body.next_cursor;
  if (!cursor || users.length === 0) break;
}

console.log("Privy users scanned:        ", totalSeen);
console.log("Created after cutoff:        ", postCutoff);
console.log("Missing from welcome_airdrops:", candidates.length);
console.log("");

if (candidates.length) {
  candidates.sort((a, b) => a.created_at_iso.localeCompare(b.created_at_iso));
  for (const c of candidates) {
    console.log(`  ${c.created_at_iso}  ${c.address}  ${c.email ?? "-"}`);
  }
  writeFileSync(OUT, JSON.stringify(candidates, null, 2));
  console.log("");
  console.log(`Wrote ${candidates.length} entries to ${OUT}`);
  console.log("");
  console.log("Next step:");
  console.log(`  node scripts/refund-csp-regression.mjs --file ${OUT}            # dry-run`);
  console.log(`  node scripts/refund-csp-regression.mjs --file ${OUT} --execute  # send`);
} else {
  console.log("No victims found.");
}
