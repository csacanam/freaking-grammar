// Disposable / throwaway email domains, blocked from the welcome-gas airdrop.
//
// Why: the airdrop is one-per-address, so the only way to farm it is to mint
// new Privy users — and the cheapest way to do that is a temp-mail inbox.
// The 2026-07-25 cluster (oudxuz8897…88973@fextemp.com, three signups inside
// 90 seconds) is exactly that shape. Blocking the domain kills the whole
// cluster without touching a single real user, since nobody signs up for a
// daily game with an inbox that expires in ten minutes.
//
// This list will always lag — temp-mail providers rotate domains constantly
// (fextemp/lnovic/fxzig are all the same operator). DISPOSABLE_EMAIL_DOMAINS
// lets us block a newly-observed domain with an env change instead of a code
// change, which matters when the response window is hours, not days.
//
// Deliberately NOT blocked: aliasing services people actually live in
// (simplelogin.com, pm.me, icloud "hide my email", gmail +tags). Those are
// privacy tools used by real players — one of our returning users is on
// simplelogin.com. Multi-wallet abuse from those is a leaderboard problem,
// not a gas problem, and blocking them would cost us real signups.

const BUILTIN_DISPOSABLE_DOMAINS = [
  // observed in our own signup data
  "fextemp.com",
  "lnovic.com",
  "fxzig.com",
  // common public temp-mail providers
  "10minutemail.com",
  "20minutemail.com",
  "dispostable.com",
  "dropmail.me",
  "emailondeck.com",
  "fakeinbox.com",
  "getairmail.com",
  "getnada.com",
  "guerrillamail.com",
  "guerrillamail.info",
  "inboxkitten.com",
  "mailcatch.com",
  "maildrop.cc",
  "mailinator.com",
  "mailnesia.com",
  "moakt.com",
  "mohmal.com",
  "sharklasers.com",
  "spam4.me",
  "temp-mail.io",
  "temp-mail.org",
  "tempmail.com",
  "tempmailo.com",
  "throwawaymail.com",
  "trashmail.com",
  "yopmail.com",
];

function blockedDomains(): Set<string> {
  const extra = (process.env.DISPOSABLE_EMAIL_DOMAINS ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  return new Set([...BUILTIN_DISPOSABLE_DOMAINS, ...extra]);
}

/**
 * True when `email` is on a known throwaway-inbox domain. Subdomains count
 * (`a.mailinator.com`) because providers hand those out per-user. A missing
 * or malformed email is NOT treated as disposable — Privy social logins can
 * legitimately have no email, and rejecting those would break real signups.
 */
export function isDisposableEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const domain = email.toLowerCase().trim().split("@")[1];
  if (!domain) return false;
  const blocked = blockedDomains();
  if (blocked.has(domain)) return true;
  // Match parent domains so `mail.fextemp.com` is caught by `fextemp.com`.
  return [...blocked].some((d) => domain.endsWith(`.${d}`));
}
