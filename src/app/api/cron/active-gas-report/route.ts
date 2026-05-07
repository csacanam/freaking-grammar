// Twice-daily gas check for Privy embedded-wallet users. Now does
// TWO things:
//   1. Auto-refills any active Privy user whose balance dropped below
//      the RED threshold, sending 0.1 CELO from the operator wallet
//      so they don't get stuck mid-session. Per-user cooldown of 6h
//      prevents double-refilling on consecutive cron runs.
//   2. Sends a Telegram report summarising the auto-refills and any
//      remaining yellow-zone users who are watch-but-not-yet-empty.
//
// Why only Privy users: external wallets (MetaMask / MiniPay /
// Farcaster / Rabby) belong to crypto-natives who manage their own
// gas. Auto-refilling them invites farming and isn't our value-add.
// Privy embedded wallet users are non-crypto-native and rely on us
// for the gas plumbing.
//
// "Active" = ≥1 finished run in the last 7 days.
//
// Threshold calibration. Measured settled costs are tiny:
//   - free play:  ~0.0034 CELO
//   - paid play:  ~0.0080 CELO
// BUT the wallet pre-flight check uses `gas_limit × max_fee_per_gas`,
// where max_fee is set ~5x the effective gas price as a safety buffer
// (480 gwei reserved vs 100 gwei actually charged on Celo). So a paid
// play tx wallet pre-flight requires ~0.04 CELO, and the chain still
// only charges 0.008 once it settles. Real-world: a user at 0.0384
// CELO had a paid play rejected pre-flight by 0.0005 CELO. Thresholds
// reflect what the WALLET demands, not what the chain charges:
//   RED    = 0.05 CELO  → can't reliably afford a paid play
//   YELLOW = 0.10 CELO  → ~2-3 paid plays of buffer left at high gas
// REFILL_AMOUNT stays at 0.1 — at high gas that's ~2.5 paid plays;
// at normal gas it's ~12 plays. Wide enough.
//
// Fires at 12:00 UTC (7am Bogotá) and 00:00 UTC (7pm Bogotá) via
// cron-job.org. Auth: CRON_SECRET in Authorization header.

import type { NextRequest } from "next/server";
import {
  createWalletClient,
  formatEther,
  http,
  parseEther,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { supabase, todayUtc } from "@/lib/supabase";
import { celoClient } from "@/lib/onchain";
import { CELO_RPC_URL } from "@/lib/chain";
import { sendTelegramMessage } from "@/lib/telegram";

export const dynamic = "force-dynamic";
// Auto-refill loop hits up to MAX_PER_BUCKET addresses with on-chain
// transfers, each ~3-5s on Celo. With a few yellow-zone candidates +
// cold start the route can run 30-40s; 60s is the ceiling.
export const maxDuration = 60;

const ACTIVE_DAYS = 7;
// Calibrated against real wallet pre-flight (see file header).
const RED_THRESHOLD = parseEther("0.05"); // can't reliably afford a paid play
const YELLOW_THRESHOLD = parseEther("0.1"); // ~2-3 paid plays at high gas
const REFILL_AMOUNT = parseEther("0.1"); // ~30 paid plays of headroom
// A user can only be auto-refilled once every 6h. Twin cron schedule
// runs every 12h, so this leaves room for an emergency manual
// trigger between scheduled reports without immediately re-firing.
const REFILL_COOLDOWN_HOURS = 6;
const MAX_PER_BUCKET = 15;

type Subscriber = {
  address: string;
  email: string | null;
};

type Snapshot = Subscriber & {
  plays7d: number;
  celoWei: bigint;
};

type RefillResult = {
  address: string;
  email: string | null;
  txHash?: Hex;
  error?: string;
};

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
  }
  if (!supabase) {
    return Response.json({ error: "db-unconfigured" }, { status: 503 });
  }

  // 1. Privy users (welcome_airdrops with a real airdrop tx).
  const { data: airdrops, error: airdropsErr } = await supabase
    .from("welcome_airdrops")
    .select("address,email")
    .not("tx_hash", "is", null);
  if (airdropsErr) {
    return Response.json(
      { error: "db-query-failed", detail: airdropsErr.message },
      { status: 500 },
    );
  }
  const privyUsers = (airdrops ?? []) as Subscriber[];

  // 2. Recent runs to find active players.
  const cutoff = daysAgoUtc(ACTIVE_DAYS);
  const { data: recentRuns } = await supabase
    .from("runs")
    .select("player")
    .eq("status", "finished")
    .gte("day_utc", cutoff);
  const playsByPlayer = new Map<string, number>();
  for (const r of (recentRuns ?? []) as Array<{ player: string }>) {
    const key = r.player.toLowerCase();
    playsByPlayer.set(key, (playsByPlayer.get(key) ?? 0) + 1);
  }

  // 3. Snapshot balances for active Privy users.
  const active = privyUsers.filter((u) =>
    playsByPlayer.has(u.address.toLowerCase()),
  );
  const snapshots: Snapshot[] = await Promise.all(
    active.map(async (u): Promise<Snapshot> => {
      let celoWei = 0n;
      try {
        celoWei = await celoClient.getBalance({
          address: u.address as `0x${string}`,
        });
      } catch {
        /* RPC hiccup — surface as red */
      }
      return {
        ...u,
        plays7d: playsByPlayer.get(u.address.toLowerCase()) ?? 0,
        celoWei,
      };
    }),
  );

  const red = snapshots
    .filter((s) => s.celoWei < RED_THRESHOLD)
    .sort((a, b) => Number(a.celoWei - b.celoWei));
  const yellow = snapshots
    .filter(
      (s) => s.celoWei >= RED_THRESHOLD && s.celoWei < YELLOW_THRESHOLD,
    )
    .sort((a, b) => Number(a.celoWei - b.celoWei));
  const healthy = snapshots.filter((s) => s.celoWei >= YELLOW_THRESHOLD);
  const lowestHealthy = healthy.length
    ? healthy.reduce(
        (min, s) => (s.celoWei < min ? s.celoWei : min),
        healthy[0].celoWei,
      )
    : null;

  // 4. Auto-refill the RED users that aren't on cooldown.
  const refilled: RefillResult[] = [];
  const skipped: Array<{ address: string; reason: string }> = [];
  if (red.length > 0) {
    const cooldownAddresses = await loadOnCooldown(
      red.map((r) => r.address.toLowerCase()),
    );
    const operatorPk = process.env.OPERATOR_PRIVATE_KEY;
    if (!operatorPk) {
      for (const r of red) {
        skipped.push({
          address: r.address,
          reason: "no-operator-key",
        });
      }
    } else {
      const account = privateKeyToAccount(
        (operatorPk.startsWith("0x") ? operatorPk : `0x${operatorPk}`) as Hex,
      );
      const walletClient = createWalletClient({
        account,
        chain: celo,
        transport: http(CELO_RPC_URL),
      });
      for (const u of red) {
        const lower = u.address.toLowerCase();
        if (cooldownAddresses.has(lower)) {
          skipped.push({ address: lower, reason: "cooldown" });
          continue;
        }
        try {
          const txHash = await walletClient.sendTransaction({
            to: u.address as `0x${string}`,
            value: REFILL_AMOUNT,
          });
          await celoClient.waitForTransactionReceipt({ hash: txHash });
          await supabase.from("gas_refills").insert({
            tx_hash: txHash,
            address: lower,
            amount_wei: REFILL_AMOUNT.toString(),
            trigger: "auto-cron",
          });
          refilled.push({ address: lower, email: u.email, txHash });
        } catch (e) {
          refilled.push({
            address: lower,
            email: u.email,
            error: (e as Error).message.slice(0, 120),
          });
        }
      }
    }
  }

  // 5. Format Telegram message.
  const text = formatMessage({
    activeTotal: active.length,
    refilled,
    skipped,
    yellow,
    healthyCount: healthy.length,
    lowestHealthy,
  });
  const sent = await sendTelegramMessage(text);

  return Response.json({
    activeTotal: active.length,
    redCandidates: red.length,
    refilled: refilled.filter((r) => r.txHash).length,
    refillFailed: refilled.filter((r) => r.error).length,
    skipped: skipped.length,
    yellow: yellow.length,
    healthy: healthy.length,
    sent,
  });
}

// Returns the set of addresses (lower-case) that have been refilled
// within REFILL_COOLDOWN_HOURS, so we don't double-fund.
async function loadOnCooldown(
  addresses: string[],
): Promise<Set<string>> {
  if (addresses.length === 0) return new Set();
  const cutoffIso = new Date(
    Date.now() - REFILL_COOLDOWN_HOURS * 3600_000,
  ).toISOString();
  const { data } = await supabase!
    .from("gas_refills")
    .select("address")
    .in("address", addresses)
    .gte("refilled_at", cutoffIso);
  return new Set(((data ?? []) as Array<{ address: string }>).map((r) => r.address));
}

function formatMessage(args: {
  activeTotal: number;
  refilled: RefillResult[];
  skipped: Array<{ address: string; reason: string }>;
  yellow: Snapshot[];
  healthyCount: number;
  lowestHealthy: bigint | null;
}): string {
  const { activeTotal, refilled, skipped, yellow, healthyCount, lowestHealthy } =
    args;
  const lines: string[] = [];

  const success = refilled.filter((r) => r.txHash);
  const failed = refilled.filter((r) => r.error);

  if (success.length === 0 && failed.length === 0 && yellow.length === 0) {
    lines.push("*⛽ Privy gas — all clear*");
    if (activeTotal > 0 && lowestHealthy !== null) {
      lines.push(
        `${activeTotal} active users · lowest at ${formatEther(lowestHealthy).slice(0, 6)} CELO`,
      );
    } else if (activeTotal === 0) {
      lines.push(`No active users in the last ${ACTIVE_DAYS} days.`);
    }
    return lines.join("\n");
  }

  lines.push(`*⛽ Privy gas check* (${activeTotal} active)`);

  if (success.length > 0) {
    lines.push("");
    lines.push(`*🤖 Auto-refilled ${success.length} (0.1 CELO each)*`);
    for (const r of success.slice(0, MAX_PER_BUCKET)) {
      lines.push(`• ${obfuscateEmail(r.email)}`);
    }
    if (success.length > MAX_PER_BUCKET) {
      lines.push(`…and ${success.length - MAX_PER_BUCKET} more`);
    }
  }

  if (failed.length > 0) {
    lines.push("");
    lines.push(`*⚠️ Refill failed (${failed.length})*`);
    for (const r of failed.slice(0, MAX_PER_BUCKET)) {
      lines.push(`• ${obfuscateEmail(r.email)} — ${r.error}`);
    }
  }

  const skippedCooldown = skipped.filter((s) => s.reason === "cooldown");
  if (skippedCooldown.length > 0) {
    lines.push("");
    lines.push(
      `_${skippedCooldown.length} on cooldown — already refilled in the last ${REFILL_COOLDOWN_HOURS}h_`,
    );
  }

  if (yellow.length > 0) {
    lines.push("");
    lines.push("*🟡 WATCH — under 0.1 CELO*");
    for (const s of yellow.slice(0, MAX_PER_BUCKET)) {
      lines.push(
        `• ${obfuscateEmail(s.email)}  ·  ${s.plays7d} plays  ·  ${formatEther(s.celoWei).slice(0, 6)} CELO`,
      );
    }
    if (yellow.length > MAX_PER_BUCKET) {
      lines.push(`…and ${yellow.length - MAX_PER_BUCKET} more`);
    }
  }

  lines.push("");
  if (healthyCount > 0 && lowestHealthy !== null) {
    lines.push(
      `Rest healthy (${healthyCount}). Lowest healthy: ${formatEther(lowestHealthy).slice(0, 6)} CELO.`,
    );
  } else {
    lines.push("All other active users are below threshold.");
  }
  return lines.join("\n");
}

function obfuscateEmail(email: string | null): string {
  if (!email) return "(no email)";
  const [user, domain] = email.split("@");
  if (!domain) return email;
  // Telegram Markdown parses `*` as bold delimiter; three asterisks
  // would break the entity. Use ellipsis.
  return `${user.slice(0, 3)}…@${domain}`;
}

function daysAgoUtc(days: number): string {
  const today = todayUtc();
  const d = new Date(today + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}
