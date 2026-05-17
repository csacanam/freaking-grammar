// One-time CELO airdrop so newly-provisioned Privy embedded wallets can
// actually sign their first play() tx. Idempotent via the primary key on
// `welcome_airdrops.address` — a replay hits the existing row and no-ops.
//
// Security model: we trust client-submitted `{ address, email }` because
// (a) the airdrop amount is intentionally small ($0.03 worth of CELO) so
// the worst-case abuse is low-value, and (b) the idempotency key prevents
// the same address from draining us more than once. If abuse ever shows
// up in `welcome_airdrops` logs we can add Privy token verification as a
// second line of defense.

import type { NextRequest } from "next/server";
import {
  createWalletClient,
  http,
  parseEther,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { supabase } from "@/lib/supabase";
import { CELO_RPC_URL } from "@/lib/chain";
import { celoClient } from "@/lib/onchain";
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
  };
  const address = body.address?.toLowerCase();
  if (!address || !/^0x[0-9a-f]{40}$/.test(address)) {
    return Response.json({ error: "invalid-address" }, { status: 400 });
  }
  const email = body.email ?? null;
  const lang = body.lang === "en" || body.lang === "es" ? body.lang : null;

  // Idempotency FIRST, before the captcha. Reason: the bridge re-mounts on
  // every page navigation and refires this endpoint to check its own state;
  // if captcha were enforced up-front, every returning user would see the
  // Turnstile modal on every page load even though their airdrop landed
  // weeks ago. By checking the DB first we let returning users sail through
  // with no captcha while keeping the actual "send CELO" step still gated.
  const { data: existing } = await supabase
    .from("welcome_airdrops")
    .select("address,tx_hash")
    .eq("address", address)
    .maybeSingle();
  if (existing) {
    return Response.json({
      status: "already-airdropped",
      txHash: (existing as { tx_hash: string | null }).tx_hash,
    });
  }

  // Skip if the wallet already has enough CELO — happens if the user funded
  // it themselves or re-logged after an earlier fund from outside. Log a
  // sentinel row (amount=0, tx_hash=null) so future hits short-circuit on
  // the existing-row branch above. No captcha required: the worst-case
  // abuse is a 0-CELO row insert with no economic value to the attacker.
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
    transport: http(CELO_RPC_URL),
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
