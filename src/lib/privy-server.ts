// Server-side Privy identity verification for /api/welcome-gas.
//
// The problem this closes: welcome-gas used to trust the `{address, email}`
// the browser posted. Turnstile proved a human was present, but nothing tied
// that human to the address being funded — so anyone who could solve a
// captcha could pull 0.1 CELO to an arbitrary wallet, no Privy account
// required. Four wallets in the 2026-07-25 cluster still hold their airdrop
// untouched, which is what that looks like from the outside.
//
// The fix: derive the address and email from Privy server-side and ignore
// what the client claims. Two tokens are involved and they do different jobs:
//
//   - access token  (`getAccessToken()`)   — an ES256 JWT proving "this is a
//     logged-in user of THIS app". Verified locally against Privy's JWKS by
//     the SDK. Carries the user's DID but no account details.
//   - identity token (`useIdentityToken()`) — a signed snapshot of the user's
//     linked accounts. `getUser({idToken})` parses it locally, so resolving
//     the wallet costs no API call and hits no rate limit.
//
// Identity tokens must be enabled in the Privy dashboard. If they're off (or
// the client is on an older bundle), we fall back to `getUserById`, which is
// a real API call under strict rate limits. That's acceptable here only
// because the caller reaches this code once per NEW address — returning
// users short-circuit on the DB idempotency check before we ever get here.
//
// Defensive default matches verifyTurnstile: with PRIVY_APP_SECRET unset the
// helper reports `skipped: true` so dev environments keep working without
// server credentials.

import { PrivyClient } from "@privy-io/server-auth";
import type { User } from "@privy-io/server-auth";

export type PrivyVerifyResult =
  | {
      ok: true;
      skipped: true;
      address: null;
      email: null;
    }
  | {
      ok: true;
      skipped: false;
      /** Lower-case address of the user's Privy embedded wallet. */
      address: string;
      email: string | null;
      userId: string;
    }
  | { ok: false; reason: string };

let cached: PrivyClient | null = null;

function client(): PrivyClient | null {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const secret = process.env.PRIVY_APP_SECRET;
  if (!appId || !secret) return null;
  cached ??= new PrivyClient(appId, secret);
  return cached;
}

/**
 * Pick the *embedded* wallet, not `user.wallet` — that field is the most
 * recently linked wallet, so a user who later connects MetaMask would have
 * us funding their MetaMask address instead of the Privy wallet that
 * actually needs gas.
 */
function embeddedWalletAddress(user: User): string | null {
  for (const account of user.linkedAccounts) {
    if (account.type !== "wallet") continue;
    if (account.walletClientType !== "privy") continue;
    if (account.chainType !== "ethereum") continue;
    return account.address.toLowerCase();
  }
  return null;
}

export async function verifyPrivyUser(args: {
  accessToken: string | undefined | null;
  identityToken: string | undefined | null;
}): Promise<PrivyVerifyResult> {
  const privy = client();
  if (!privy) {
    if (process.env.NODE_ENV === "production") {
      console.warn("[privy] app secret not configured — skipping verification");
    }
    return { ok: true, skipped: true, address: null, email: null };
  }

  if (!args.accessToken) {
    return { ok: false, reason: "missing-access-token" };
  }

  let userId: string;
  try {
    const claims = await privy.verifyAuthToken(args.accessToken);
    userId = claims.userId;
  } catch (e) {
    // Expired or forged token. Expiry is routine (tokens are short-lived and
    // a tab can sit open), so this is a warn, not an error.
    console.warn("[privy] access token rejected:", (e as Error).message);
    return { ok: false, reason: "invalid-access-token" };
  }

  let user: User;
  try {
    user = args.identityToken
      ? await privy.getUser({ idToken: args.identityToken })
      : await privy.getUserById(userId);
  } catch (e) {
    console.error("[privy] user lookup failed:", (e as Error).message);
    return { ok: false, reason: "user-lookup-failed" };
  }

  // An identity token is signed by Privy but supplied by the client, so it
  // could belong to a *different* real user. Binding it to the access
  // token's DID is what makes the pair trustworthy.
  if (user.id !== userId) {
    console.error(
      `[privy] token mismatch: access=${userId} identity=${user.id}`,
    );
    return { ok: false, reason: "token-user-mismatch" };
  }

  const address = embeddedWalletAddress(user);
  if (!address) {
    return { ok: false, reason: "no-embedded-wallet" };
  }

  return {
    ok: true,
    skipped: false,
    address,
    email: user.email?.address?.toLowerCase() ?? null,
    userId,
  };
}
