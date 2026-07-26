// One-time CELO airdrop so newly-provisioned Privy embedded wallets can
// actually sign their first play() tx. Idempotent via the primary key on
// `welcome_airdrops.address` — a replay hits the existing row and no-ops.
//
// Security model, three layers, each guarding the *spend* and nothing else:
//   1. Privy token verification — the funded address and the recorded email
//      come from Privy server-side, never from the request body. Closes the
//      old hole where a captcha solve was enough to pull CELO to any wallet.
//   2. Disposable-email block — temp-mail inboxes are the cheap way to mint
//      the fresh Privy users this airdrop is keyed on.
//   3. Turnstile — proves a human is present.
// Plus the `welcome_airdrops` primary key, which caps any single address at
// one airdrop no matter how the request arrives.

import type { NextRequest } from "next/server";
import {
  createWalletClient,
  parseEther,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { ATTRIBUTION_SUFFIX } from "@/lib/attribution";
import { supabase } from "@/lib/supabase";
import { CELO_TRANSPORT } from "@/lib/chain";
import { isDisposableEmail } from "@/lib/disposable-email";
import { celoClient } from "@/lib/onchain";
import { verifyPrivyUser } from "@/lib/privy-server";
import { sendTelegramMessage } from "@/lib/telegram";
import { verifyTurnstile } from "@/lib/turnstile";

export const dynamic = "force-dynamic";

// 0.1 CELO ≈ $0.03 at current prices. Enough runway for ~200 plays on Celo.
const AIRDROP_AMOUNT_WEI = parseEther("0.1");
// Don't airdrop if the target already has this much. Someone funding their
// own embedded wallet shouldn't get topped up redundantly.
const BALANCE_THRESHOLD_WEI = parseEther("0.005");

export async function POST(req: NextRequest) {
  if (!supabase) {
    return Response.json({ error: "db-unconfigured" }, { status: 503 });
  }
  const pk = process.env.OPERATOR_PRIVATE_KEY;
  if (!pk) {
    return Response.json({ error: "no-operator-key" }, { status: 503 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    address?: string;
    email?: string;
    lang?: string;
    turnstileToken?: string;
    privyAccessToken?: string;
    privyIdentityToken?: string;
  };
  const claimedAddress = body.address?.toLowerCase();
  if (!claimedAddress || !/^0x[0-9a-f]{40}$/.test(claimedAddress)) {
    return Response.json({ error: "invalid-address" }, { status: 400 });
  }
  const lang = body.lang === "en" || body.lang === "es" ? body.lang : null;

  // Idempotency FIRST, before the captcha *and* before Privy verification.
  // Reason: the bridge re-mounts on every page navigation and refires this
  // endpoint to check its own state; if captcha were enforced up-front,
  // every returning user would see the Turnstile modal on every page load
  // even though their airdrop landed weeks ago. Skipping verification here
  // is safe because this branch only reads — an attacker who lies about the
  // address learns whether it was already funded, and nothing else. It also
  // keeps the Privy `getUserById` fallback off the hot path.
  const { data: existing } = await supabase
    .from("welcome_airdrops")
    .select("address,tx_hash")
    .eq("address", claimedAddress)
    .maybeSingle();
  if (existing) {
    return Response.json({
      status: "already-airdropped",
      txHash: (existing as { tx_hash: string | null }).tx_hash,
    });
  }

  // Past this point every branch can spend CELO or write a row, so stop
  // believing the client. `address` and `email` are Privy's answer from
  // here on; the request body's versions are discarded.
  const privy = await verifyPrivyUser({
    accessToken: body.privyAccessToken,
    identityToken: body.privyIdentityToken,
  });
  if (!privy.ok) {
    console.warn(
      `welcome-gas privy-rejected reason=${privy.reason} claimed=${claimedAddress}`,
    );
    return Response.json(
      { error: "privy-unverified", reason: privy.reason },
      { status: 403 },
    );
  }

  // `skipped` means no server credentials configured (dev). Fall back to the
  // client's claim so local testing still works without a Privy app secret.
  const address = privy.skipped ? claimedAddress : privy.address;
  const email = privy.skipped ? body.email ?? null : privy.email;

  // The verified address can differ from the claimed one — a stale bridge
  // after a wallet switch, or someone probing. Re-check idempotency against
  // the address we're actually about to fund so a mismatch can't produce a
  // second airdrop.
  if (address !== claimedAddress) {
    const { data: dupe } = await supabase
      .from("welcome_airdrops")
      .select("address,tx_hash")
      .eq("address", address)
      .maybeSingle();
    if (dupe) {
      return Response.json({
        status: "already-airdropped",
        txHash: (dupe as { tx_hash: string | null }).tx_hash,
      });
    }
  }

  // Throwaway inboxes are how the airdrop gets farmed: the payout is keyed
  // on a fresh Privy user, and temp-mail makes those free to mint. Rejected
  // before the balance check so we don't even log a sentinel row for them.
  if (isDisposableEmail(email)) {
    console.warn(
      `welcome-gas disposable-email addr=${address} email=${email}`,
    );
    notifyDisposableRejection({ address, email }).catch((e) =>
      console.error("welcome-gas notify-disposable failed:", e),
    );
    return Response.json(
      { error: "disposable-email" },
      { status: 403 },
    );
  }

  // Skip if the wallet already has enough CELO — happens if the user funded
  // it themselves or re-logged after an earlier fund from outside. Log a
  // sentinel row (amount=0, tx_hash=null) so future hits short-circuit on
  // the existing-row branch above. No captcha required: `address` is
  // Privy-verified by now, so the row can only ever describe the caller's
  // own wallet, and it costs us nothing.
  try {
    const bal = await celoClient.getBalance({
      address: address as `0x${string}`,
    });
    if (bal >= BALANCE_THRESHOLD_WEI) {
      await supabase.from("welcome_airdrops").insert({
        address,
        email,
        lang,
        amount_wei: "0",
        tx_hash: null,
      });
      return Response.json({ status: "already-funded", balance: bal.toString() });
    }
  } catch {
    /* RPC hiccup — proceed with airdrop */
  }

  // From here on we're spending CELO on a brand-new address, so this is
  // where the anti-Sybil captcha actually matters. If the client deliberately
  // didn't send a token (preflight call from the bridge), return 401 with a
  // distinct status so the bridge knows to show the modal — vs 403 which is
  // a real Turnstile verification failure worth alerting on.
  const remoteIp =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    undefined;

  if (!body.turnstileToken) {
    return Response.json(
      { error: "captcha-required" },
      { status: 401 },
    );
  }

  const turnstile = await verifyTurnstile(body.turnstileToken, remoteIp);
  if (!turnstile.ok) {
    // Logged + Telegram-pinged so we hear about false positives in
    // real time instead of waiting for users to complain. Reaching this
    // branch means the user did submit a token but Cloudflare rejected
    // it — almost always a legitimate user with a bad fingerprint.
    const ua = req.headers.get("user-agent") ?? "";
    console.error(
      `welcome-gas captcha-failed reason=${turnstile.reason} addr=${address} ip=${remoteIp ?? "?"} ua="${ua}"`,
    );
    notifyCaptchaRejection({
      address,
      email,
      reason: turnstile.reason,
      ip: remoteIp,
      ua,
    }).catch((e) => console.error("welcome-gas notify-rejection failed:", e));

    return Response.json(
      { error: "captcha-failed", reason: turnstile.reason },
      { status: 403 },
    );
  }

  const account = privateKeyToAccount(
    (pk.startsWith("0x") ? pk : `0x${pk}`) as Hex,
  );
  const walletClient = createWalletClient({
    account,
    chain: celo,
    transport: CELO_TRANSPORT,
    // Celo ERC-8021 attribution — client-level suffix, so it rides along
    // on every writeContract / sendTransaction made with this client.
    dataSuffix: ATTRIBUTION_SUFFIX,
  });

  let txHash: Hex;
  try {
    txHash = await walletClient.sendTransaction({
      to: address as `0x${string}`,
      value: AIRDROP_AMOUNT_WEI,
    });
    await celoClient.waitForTransactionReceipt({ hash: txHash });
  } catch (e) {
    console.error("welcome-gas airdrop failed:", e);
    return Response.json(
      { error: "transfer-failed", reason: (e as Error).message },
      { status: 500 },
    );
  }

  await supabase.from("welcome_airdrops").insert({
    address,
    email,
    lang,
    amount_wei: AIRDROP_AMOUNT_WEI.toString(),
    tx_hash: txHash,
  });

  // Fire a Telegram ping so we can eyeball onboarding volume + catch a
  // draining operator before the treasury-alert cycles around. Best-effort;
  // notification failure doesn't rollback the airdrop.
  notifyAirdrop({
    address,
    email,
    txHash,
    operator: account.address,
  }).catch((e) => console.error("welcome-gas notify failed:", e));

  return Response.json({
    status: "airdropped",
    amount: AIRDROP_AMOUNT_WEI.toString(),
    txHash,
  });
}

async function notifyAirdrop(args: {
  address: string;
  email: string | null;
  txHash: Hex;
  operator: `0x${string}`;
}) {
  const [operatorBal, totalAirdrops] = await Promise.all([
    celoClient.getBalance({ address: args.operator }).catch(() => 0n),
    (async () => {
      try {
        const { count } = await supabase!
          .from("welcome_airdrops")
          .select("*", { count: "exact", head: true })
          .not("tx_hash", "is", null);
        return count ?? 0;
      } catch {
        return 0;
      }
    })(),
  ]);
  const operatorCELO = Number(operatorBal) / 1e18;
  const remainingAirdrops = Math.floor(operatorCELO / 0.1);
  const lines = [
    "*🎁 Welcome gas sent*",
    `→ \`${args.address}\``,
    args.email ? `📧 ${args.email}` : null,
    `💸 0.1 CELO · tx \`${args.txHash.slice(0, 10)}…\``,
    `🧾 ${totalAirdrops} onboardings total`,
    `⛽ Operator: ${operatorCELO.toFixed(3)} CELO (~${remainingAirdrops} airdrops left)`,
  ].filter((s): s is string => s !== null);
  await sendTelegramMessage(lines.join("\n"));
}

// Farming attempts are worth seeing in real time — a burst of these is the
// signal that a temp-mail provider rotated to a domain we don't block yet,
// which is fixed by appending it to DISPOSABLE_EMAIL_DOMAINS.
//
// Rejected addresses never get a `welcome_airdrops` row, so nothing in the
// DB stops the bridge's per-page-load preflight from re-pinging us forever.
// This in-memory set is the dedupe: instances are reused under Fluid
// Compute, so a farmer reloading in a loop costs one message, and a cold
// start at worst repeats it once. Capped so a flood can't grow it without
// bound.
const notifiedDisposable = new Set<string>();
const NOTIFIED_DISPOSABLE_MAX = 500;

async function notifyDisposableRejection(args: {
  address: string;
  email: string | null;
}) {
  if (notifiedDisposable.has(args.address)) return;
  if (notifiedDisposable.size >= NOTIFIED_DISPOSABLE_MAX) {
    notifiedDisposable.clear();
  }
  notifiedDisposable.add(args.address);

  const lines = [
    "*🗑 Welcome gas blocked — disposable email*",
    `→ \`${args.address}\``,
    args.email ? `📧 ${args.email}` : null,
  ].filter((s): s is string => s !== null);
  await sendTelegramMessage(lines.join("\n"));
}

// Real-time signal for Turnstile false positives. Cloudflare's risk model
// occasionally flags legitimate users (mobile WebViews, residential VPNs,
// reduced-fingerprint Chrome) and the only way to find out used to be a
// support ticket. This ping surfaces the rejection immediately with enough
// context (reason, IP, UA) to decide whether to refund manually and whether
// the failure rate is high enough to loosen the Cloudflare config.
async function notifyCaptchaRejection(args: {
  address: string;
  email: string | null;
  reason: string;
  ip: string | undefined;
  ua: string;
}) {
  const lines = [
    "*🚫 Welcome gas captcha-rejected*",
    `→ \`${args.address}\``,
    args.email ? `📧 ${args.email}` : null,
    `❓ reason: \`${args.reason}\``,
    args.ip ? `🌐 ip: \`${args.ip}\`` : null,
    args.ua ? `🖥 ua: \`${args.ua.slice(0, 80)}\`` : null,
  ].filter((s): s is string => s !== null);
  await sendTelegramMessage(lines.join("\n"));
}
