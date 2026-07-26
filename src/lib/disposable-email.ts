// Disposable / throwaway email domains, blocked from the welcome-gas airdrop.
//
// Why: the airdrop is one-per-address, so minting fresh accounts is the only
// way to draw it repeatedly, and a throwaway inbox makes that free. Nobody
// signs up for a daily game with an inbox that expires in ten minutes.
//
// Coverage comes from `disposable-email-domains` (~121k domains, MIT, still
// maintained). Verified against the mail providers our real players actually
// use — the big consumer hosts, the privacy forwarders, and the .edu domains
// in our signup table — and it flags none of them, which is what makes it
// safe to apply to a gate that decides whether someone can play at all.
//
// DISPOSABLE_EMAIL_DOMAINS extends the list from the deploy env. Same split
// we use for the Celo attribution tag: mechanism in the repo, values in the
// environment. Keeping it there means the list can change without shipping a
// build, which matters when the package release cadence is slower than we
// need it to be.

import disposableDomains from "disposable-email-domains";
import wildcardDomains from "disposable-email-domains/wildcard.json";

// Built once per instance, not per call: 121k strings is real work to hash,
// and under Fluid Compute the instance handles many requests. `wildcard.json`
// ships separately from `index.json` and holds the providers whose subdomains
// are handed out per-user, so both feed the same suffix check below.
let cachedEnv: string | undefined;
let cachedSet: Set<string> | null = null;

function blockedDomains(): Set<string> {
  const env = process.env.DISPOSABLE_EMAIL_DOMAINS ?? "";
  if (cachedSet && cachedEnv === env) return cachedSet;
  const extra = env
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  cachedSet = new Set([
    ...(disposableDomains as string[]),
    ...(wildcardDomains as string[]),
    ...extra,
  ]);
  cachedEnv = env;
  return cachedSet;
}

/**
 * True when `email` is on a known throwaway-inbox domain. Subdomains count
 * because providers hand those out per-user. A missing or malformed email is
 * NOT treated as disposable — Privy social logins can legitimately have no
 * email, and rejecting those would break real signups.
 */
export function isDisposableEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const domain = email.toLowerCase().trim().split("@")[1];
  if (!domain) return false;
  const blocked = blockedDomains();
  if (blocked.has(domain)) return true;
  // Walk the parent domains so `mail.example.com` is caught by `example.com`.
  // Iterating labels rather than scanning the whole set keeps this O(labels)
  // instead of O(121k) per call.
  const labels = domain.split(".");
  for (let i = 1; i < labels.length - 1; i++) {
    if (blocked.has(labels.slice(i).join("."))) return true;
  }
  return false;
}
