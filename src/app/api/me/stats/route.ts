// Per-wallet aggregate across every game (Grammar EN/ES, Math, etc.).
// Drop-in for the old per-lang stats endpoint, which silently excluded
// Math (lang=null) and yielded 0 plays / 0 wins for Math-only wallets.

import type { NextRequest } from "next/server";
import { supabase, TOKEN_DECIMALS } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const MOCK = { gamesPlayed: 12, wins: 1, totalEarnedUSD: 3.88 };

export async function GET(req: NextRequest) {
  const player = req.nextUrl.searchParams.get("player")?.toLowerCase();

  if (!supabase || !player) return Response.json(MOCK);

  const [playedRes, winsRes] = await Promise.all([
    supabase
      .from("runs")
      .select("*", { count: "exact", head: true })
      .eq("player", player)
      .eq("status", "finished"),
    supabase
      .from("wins")
      .select("amount_units")
      .eq("player", player),
  ]);

  const wins = (winsRes.data ?? []) as Array<{ amount_units: string | number }>;
  const totalEarnedUSD = wins.reduce(
    (s, w) => s + Number(w.amount_units) / TOKEN_DECIMALS,
    0,
  );

  return Response.json({
    gamesPlayed: playedRes.count ?? 0,
    wins: wins.length,
    totalEarnedUSD,
  });
}
