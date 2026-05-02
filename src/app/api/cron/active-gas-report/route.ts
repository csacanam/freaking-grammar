// Twice-daily Telegram report of Privy embedded-wallet users running
// low on CELO for gas. Read-only — does NOT auto-refill. Camilo
// decides who to top up manually from his wallet (full address shown
// in the ping for easy copy-paste).
//
// "Active" = at least one finished run in the last 7 days. Anyone
// past 7 days idle is dropped from the report — if they come back
// later and need gas, the system will catch them on the next cycle
// once they play once.
//
// Fires at 12:00 UTC (7am Bogotá — morning check) and 00:00 UTC
// (7pm Bogotá — evening check) via cron-job.org.
//
// Auth: CRON_SECRET in the Authorization header.

import type { NextRequest } from "next/server";
import { formatEther, parseEther } from "viem";
import { supabase, todayUtc } from "@/lib/supabase";
import { celoClient } from "@/lib/onchain";
import { sendTelegramMessage } from "@/lib/telegram";

export const dynamic = "force-dynamic";

const ACTIVE_DAYS = 7;
// Below 0.005 CELO ≈ ~1-2 plays of gas left. Will fail soon.
const RED_THRESHOLD = parseEther("0.005");
// Below 0.02 CELO ≈ ~5 plays. Watch list.
const YELLOW_THRESHOLD = parseEther("0.02");
// Cap how many lines we list per bucket so the Telegram message
// stays under their 4096-char limit even if many users go red at
// once.
const MAX_PER_BUCKET = 15;

type Subscriber = {
  address: string;
  email: string | null;
};

type Snapshot = Subscriber & {
  plays7d: number;
  celoWei: bigint;
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

  // 1. Privy users (welcome_airdrops with a real airdrop tx — excludes
  //    the "already-funded" rows that have tx_hash = null).
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

  // 2. Players with at least one finished run in the last ACTIVE_DAYS.
  //    Compute the cutoff via day_utc rather than ended_at so the
  //    indexed (lang, day_utc, score, ended_at) gets used.
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

  // 3. Intersect Privy users with active players, then fetch their
  //    on-chain CELO balance.
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
        /* RPC hiccup — treat as zero so it surfaces as red */
      }
      return {
        ...u,
        plays7d: playsByPlayer.get(u.address.toLowerCase()) ?? 0,
        celoWei,
      };
    }),
  );

  // 4. Bucket. Lowest balance first inside each bucket.
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
    ? healthy.reduce((min, s) => (s.celoWei < min ? s.celoWei : min), healthy[0].celoWei)
    : null;

  const text = formatMessage({
    activeTotal: active.length,
    red,
    yellow,
    healthyCount: healthy.length,
    lowestHealthy,
  });
  const sent = await sendTelegramMessage(text);

  return Response.json({
    activeTotal: active.length,
    red: red.length,
    yellow: yellow.length,
    healthy: healthy.length,
    sent,
  });
}

function formatMessage(args: {
  activeTotal: number;
  red: Snapshot[];
  yellow: Snapshot[];
  healthyCount: number;
  lowestHealthy: bigint | null;
}): string {
  const { activeTotal, red, yellow, healthyCount, lowestHealthy } = args;
  const lines: string[] = [];

  if (red.length === 0 && yellow.length === 0) {
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

  if (red.length > 0) {
    lines.push("");
    lines.push("*🔴 LOW — fund soon*");
    for (const s of red.slice(0, MAX_PER_BUCKET)) {
      lines.push(
        `• ${obfuscateEmail(s.email)}  ·  ${s.plays7d} plays  ·  ${formatEther(s.celoWei).slice(0, 6)} CELO\n   \`${s.address}\``,
      );
    }
    if (red.length > MAX_PER_BUCKET) {
      lines.push(`…and ${red.length - MAX_PER_BUCKET} more`);
    }
  }

  if (yellow.length > 0) {
    lines.push("");
    lines.push("*🟡 WATCH — under 0.02 CELO*");
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
  // in a row break the parser ("can't find end of entity"), and the
  // entire send fails. Use ellipsis instead — same visual obfuscation
  // intent, no markdown collision.
  return `${user.slice(0, 3)}…@${domain}`;
}

function daysAgoUtc(days: number): string {
  const today = todayUtc(); // YYYY-MM-DD
  const d = new Date(today + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}
