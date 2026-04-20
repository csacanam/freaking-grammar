import type { NextRequest } from "next/server";
import { isAddressEqual, zeroAddress } from "viem";
import { gameIdFor, validateLang } from "@/lib/i18n";
import {
  supabase,
  todayUtc,
  nextUtcMidnightIso,
  TOKEN_DECIMALS,
} from "@/lib/supabase";
import { POT_ADDRESS } from "@/lib/wagmi";
import {
  celoClient,
  FREAKING_POT_ABI,
  readHasFreePlayToday,
} from "@/lib/onchain";

export const dynamic = "force-dynamic";

type LeaderboardRow = {
  rank: number;
  player: string;
  score: number;
  isMe?: boolean;
};

const MOCK_LEADERBOARD: LeaderboardRow[] = [
  { rank: 1, player: "0xa11ce00000000000000000000000000000001234", score: 47 },
  { rank: 2, player: "0xbead00000000000000000000000000000000c0ff", score: 41, isMe: true },
  { rank: 3, player: "0xcafe000000000000000000000000000000000f02", score: 38 },
  { rank: 4, player: "0xd00d0000000000000000000000000000000077a1", score: 33 },
  { rank: 5, player: "0xe5cape000000000000000000000000000000091bc", score: 29 },
  { rank: 6, player: "0xfade000000000000000000000000000000000044", score: 27 },
  { rank: 7, player: "0x0b01000000000000000000000000000000000018", score: 24 },
];

export async function GET(req: NextRequest) {
  const lang = validateLang(req.nextUrl.searchParams.get("lang"));
  const gameId = gameIdFor(lang);
  const player =
    req.nextUrl.searchParams.get("player")?.toLowerCase() || null;

  if (!supabase) {
    return Response.json({
      potUSD: 1.48,
      closesAtIso: nextUtcMidnightIso(),
      leaderboard: MOCK_LEADERBOARD.map((r) => ({
        ...r,
        isMe: player ? r.isMe : r.isMe,
      })),
      playerHasFreePlay: true,
    });
  }

  const day = todayUtc();

  const [potRes, runsRes] = await Promise.all([
    supabase
      .from("pots")
      .select("amount_units,day_number")
      .eq("lang", lang)
      .eq("day_utc", day)
      .maybeSingle(),
    supabase
      .from("runs")
      .select("player,score,ended_at")
      .eq("lang", lang)
      .eq("day_utc", day)
      .eq("status", "finished")
      .order("score", { ascending: false })
      .order("ended_at", { ascending: true })
      .limit(200),
  ]);

  // Prefer the live on-chain pot so sponsorPot / seedCurrentDay calls show up
  // immediately in the UI. Fall back to the DB mirror if the RPC hiccups or
  // the contract isn't deployed yet.
  let potUSD = potRes.data?.amount_units
    ? Number(potRes.data.amount_units) / TOKEN_DECIMALS
    : 0;
  if (!isAddressEqual(POT_ADDRESS, zeroAddress)) {
    try {
      const contractDay = (await celoClient.readContract({
        address: POT_ADDRESS,
        abi: FREAKING_POT_ABI,
        functionName: "currentDay",
        args: [BigInt(gameId)],
      })) as bigint;
      const onChainPot = (await celoClient.readContract({
        address: POT_ADDRESS,
        abi: FREAKING_POT_ABI,
        functionName: "viewPot",
        args: [BigInt(gameId), contractDay],
      })) as bigint;
      potUSD = Number(onChainPot) / TOKEN_DECIMALS;
    } catch {
      /* keep DB fallback */
    }
  }

  // Best run per player (results are pre-sorted score desc, ended_at asc).
  const bestByPlayer = new Map<string, number>();
  for (const r of (runsRes.data ?? []) as Array<{ player: string; score: number }>) {
    if (!bestByPlayer.has(r.player)) {
      bestByPlayer.set(r.player, r.score);
    }
  }
  const leaderboard: LeaderboardRow[] = [...bestByPlayer.entries()].map(
    ([p, score], i) => ({
      rank: i + 1,
      player: p,
      score,
      ...(player === p ? { isMe: true } : {}),
    }),
  );

  let playerHasFreePlay = true;
  if (player) {
    // On-chain is source of truth. Fall back to DB (only terminal runs count,
    // `open` rows from abandoned tabs don't burn the allowance) if the RPC
    // hiccups or the contract isn't deployed yet.
    if (!isAddressEqual(POT_ADDRESS, zeroAddress)) {
      try {
        playerHasFreePlay = await readHasFreePlayToday(
          gameId,
          player as `0x${string}`,
        );
      } catch {
        const { count } = await supabase
          .from("runs")
          .select("*", { count: "exact", head: true })
          .eq("lang", lang)
          .eq("day_utc", day)
          .eq("player", player)
          .neq("status", "open");
        playerHasFreePlay = (count ?? 0) === 0;
      }
    } else {
      const { count } = await supabase
        .from("runs")
        .select("*", { count: "exact", head: true })
        .eq("lang", lang)
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
