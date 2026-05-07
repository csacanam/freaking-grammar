// Math lobby endpoint — same shape as Grammar's /api/lobby but
// scoped to game='math' (no lang split). Returns:
//   - potUSD: today's USDT pot for Math, prefer on-chain
//   - closesAtIso: next 00:00 UTC
//   - leaderboard: best run per player today
//   - playerHasFreePlay: per the contract's `lastFreePlayDay[player][3]`
//
// Sponsor bonuses are intentionally omitted for v1: no campaign
// targets `'math'` in its `games` array yet. When sponsors come on
// board, the same activeCampaigns / bonuses block from the Grammar
// route can be ported in, filtering campaigns where `games` includes
// 'math'.

import type { NextRequest } from "next/server";
import { isAddressEqual, zeroAddress } from "viem";
import {
  supabase,
  todayUtc,
  nextUtcMidnightIso,
  TOKEN_DECIMALS,
} from "@/lib/supabase";
import { POT_ADDRESS } from "@/lib/chain";
import {
  celoClient,
  FREAKING_POT_ABI,
  readHasFreePlayToday,
} from "@/lib/onchain";
import { loadBotBlacklist } from "@/lib/bot-detection";

export const dynamic = "force-dynamic";

const MATH_GAME_ID = 3;

export async function GET(req: NextRequest) {
  const player = req.nextUrl.searchParams.get("player")?.toLowerCase() || null;

  if (!supabase) {
    return Response.json({
      potUSD: 1.0,
      closesAtIso: nextUtcMidnightIso(),
      leaderboard: [],
      playerHasFreePlay: true,
    });
  }

  const day = todayUtc();

  // Pre-load the bot blacklist so we can drop flagged wallets at the
  // SQL layer instead of letting them eat into the limit(200) window.
  // Same reasoning as the Grammar lobby: settlement already skips
  // them, but unfiltered they dominate the live podium and demoralize
  // real players.
  const blacklist = await loadBotBlacklist(supabase);
  const blacklistFilter =
    blacklist.size > 0
      ? `(${[...blacklist].map((p) => `"${p}"`).join(",")})`
      : null;

  let runsQuery = supabase
    .from("runs")
    .select("player,score,ended_at")
    .eq("game", "math")
    .eq("day_utc", day)
    .eq("status", "finished")
    .order("score", { ascending: false })
    .order("ended_at", { ascending: true })
    .limit(200);
  if (blacklistFilter) {
    runsQuery = runsQuery.not("player", "in", blacklistFilter);
  }

  const [potRes, runsRes] = await Promise.all([
    supabase
      .from("pots")
      .select("amount_units,day_number")
      .eq("game", "math")
      .eq("day_utc", day)
      .maybeSingle(),
    runsQuery,
  ]);

  let potUSD = potRes.data?.amount_units
    ? Number(potRes.data.amount_units) / TOKEN_DECIMALS
    : 0;
  if (!isAddressEqual(POT_ADDRESS, zeroAddress)) {
    try {
      const contractDay = (await celoClient.readContract({
        address: POT_ADDRESS,
        abi: FREAKING_POT_ABI,
        functionName: "currentDay",
        args: [BigInt(MATH_GAME_ID)],
      })) as bigint;
      const onChainPot = (await celoClient.readContract({
        address: POT_ADDRESS,
        abi: FREAKING_POT_ABI,
        functionName: "viewPot",
        args: [BigInt(MATH_GAME_ID), contractDay],
      })) as bigint;
      potUSD = Number(onChainPot) / TOKEN_DECIMALS;
    } catch {
      /* keep DB fallback */
    }
  }

  // Best score per player today.
  const bestByPlayer = new Map<string, number>();
  for (const r of (runsRes.data ?? []) as Array<{
    player: string;
    score: number;
  }>) {
    if (!bestByPlayer.has(r.player)) {
      bestByPlayer.set(r.player, r.score);
    }
  }
  const leaderboard = [...bestByPlayer.entries()].map(([p, score], i) => ({
    rank: i + 1,
    player: p,
    score,
    ...(player === p ? { isMe: true } : {}),
  }));

  let playerHasFreePlay = true;
  if (player) {
    if (!isAddressEqual(POT_ADDRESS, zeroAddress)) {
      try {
        playerHasFreePlay = await readHasFreePlayToday(
          MATH_GAME_ID,
          player as `0x${string}`,
        );
      } catch {
        const { count } = await supabase
          .from("runs")
          .select("*", { count: "exact", head: true })
          .eq("game", "math")
          .eq("day_utc", day)
          .eq("player", player)
          .neq("status", "open");
        playerHasFreePlay = (count ?? 0) === 0;
      }
    } else {
      const { count } = await supabase
        .from("runs")
        .select("*", { count: "exact", head: true })
        .eq("game", "math")
        .eq("day_utc", day)
        .eq("player", player)
        .neq("status", "open");
      playerHasFreePlay = (count ?? 0) === 0;
    }
  }

  return Response.json({
    potUSD,
    closesAtIso: nextUtcMidnightIso(),
    leaderboard,
    playerHasFreePlay,
  });
}
