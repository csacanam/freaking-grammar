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
  };
  const address = body.address?.toLowerCase();
  if (!address || !/^0x[0-9a-f]{40}$/.test(address)) {
    return Response.json({ error: "invalid-address" }, { status: 400 });
  }
  const email = body.email ?? null;

  // Idempotency: already airdropped?
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
  // it themselves or re-logged after an earlier fund from outside.
  try {
    const bal = await celoClient.getBalance({
      address: address as `0x${string}`,
    });
    if (bal >= BALANCE_THRESHOLD_WEI) {
      // Log with a null tx_hash so we don't retry, but note they were funded
      // elsewhere. Keeps the email record for support.
      await supabase.from("welcome_airdrops").insert({
        address,
        email,
        amount_wei: "0",
        tx_hash: null,
      });
      return Response.json({ status: "already-funded", balance: bal.toString() });
    }
  } catch {
    /* RPC hiccup — proceed with airdrop */
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
