// Periodic sweep that runs the bot heuristic against every recent
// player, not just the daily winners. Roll-day already auto-flags as
// it walks the leaderboard, but a wallet that's a bot AND consistently
// gets beaten by humans never reaches that codepath. This sweep closes
// the gap.
//
// Math benefits indirectly: the heuristic itself is disabled for Math
// (Math timing distributions are too compressed by the tight clock to
// separate bots from humans — see bot-detection.ts comment), but bots
// that play BOTH games get flagged via their Grammar evidence and the
// blacklist propagates globally, so they're skipped in Math too.
//
// Output: a single Telegram alert per run with the newly flagged
// wallets. If nothing was flagged, the cron exits quietly to keep the
// channel signal-to-noise high.

import type { NextRequest } from "next/server";
import { fetchAllPaged, supabase } from "@/lib/supabase";
import { checkBotPlayer, loadBotBlacklist } from "@/lib/bot-detection";
import { sendTelegramMessage } from "@/lib/telegram";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const LOOKBACK_DAYS = 14;

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
  const db = supabase;

  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);

  // Scan players in both games separately so each is evaluated
  // against the timing distribution of the right game (Grammar's
  // p50 threshold is 2400ms, Math's is 800ms — see bot-detection.ts).
  // A wallet that plays both gets two independent checks; whichever
  // fires first puts them on the global blacklist.
  //
  // Paginated: a 14-day window already holds 700+ rows at current
  // volume and is days away from crossing the 1000-row cap Supabase
  // silently enforces per request. Without this, recent players would
  // start dropping off the bot-detection scan and slip through.
  const rows = await fetchAllPaged<{ player: string; game: string }>(
    (from, to) =>
      db
        .from("runs")
        .select("player,game")
        .in("game", ["grammar", "math"])
        .gte("day_utc", since)
        .neq("status", "open")
        .range(from, to),
  );

  const playersByGame = new Map<"grammar" | "math", Set<string>>([
    ["grammar", new Set()],
    ["math", new Set()],
  ]);
  for (const r of rows) {
    if (r.game === "grammar" || r.game === "math") {
      playersByGame.get(r.game)!.add(r.player.toLowerCase());
    }
  }

  // Skip wallets that are already on the blacklist — re-checking them
  // is wasted DB work, and checkBotPlayer would short-circuit on the
  // blacklist hit anyway. Pre-loading is cheaper because each skip
  // avoids the per-wallet round-trip.
  const blacklist = await loadBotBlacklist(supabase);

  type Hit = {
    player: string;
    game: "grammar" | "math";
    correctRate: number;
    p50ms: number;
    sampleSize: number;
  };
  const newlyFlagged: Hit[] = [];

  for (const [game, players] of playersByGame) {
    for (const player of players) {
      if (blacklist.has(player)) continue;
      const flag = await checkBotPlayer(player, supabase, blacklist, { game });
      if (flag.flagged && flag.reason === "heuristic") {
        newlyFlagged.push({
          player,
          game,
          correctRate: flag.correctRate,
          p50ms: flag.p50ms,
          sampleSize: flag.sampleSize,
        });
      }
    }
  }

  if (newlyFlagged.length > 0) {
    const lines: string[] = [];
    lines.push(
      `*🤖 Bot sweep — ${newlyFlagged.length} new flag${newlyFlagged.length === 1 ? "" : "s"}*`,
    );
    lines.push("");
    for (const f of newlyFlagged) {
      const short = `${f.player.slice(0, 6)}…${f.player.slice(-4)}`;
      lines.push(
        `• \`${f.player}\` (${short})\n  via ${f.game} · ${(f.correctRate * 100).toFixed(1)}% correct · p50 ${f.p50ms}ms · n=${f.sampleSize}`,
      );
    }
    lines.push("");
    lines.push(
      `Scope: Grammar + Math evidence over the last ${LOOKBACK_DAYS} days. Persisted to bot_wallets — settlement and live leaderboards skip them automatically.`,
    );
    await sendTelegramMessage(lines.join("\n"));
  }

  const totalScanned = [...playersByGame.values()].reduce(
    (s, g) => s + g.size,
    0,
  );
  return Response.json({
    scanned: totalScanned,
    skipped_blacklisted: blacklist.size,
    newly_flagged: newlyFlagged.length,
    flags: newlyFlagged,
  });
}
