import type { NextRequest } from "next/server";
import { validateLang } from "@/lib/i18n";
import { supabase, TOKEN_DECIMALS } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type UnclaimedWin = { date: string; amountUSD: number; dayNumber: number };

const MOCK: UnclaimedWin[] = [
  { date: "2026-04-15", amountUSD: 3.88, dayNumber: 12 },
];

export async function GET(req: NextRequest) {
  const lang = validateLang(req.nextUrl.searchParams.get("lang"));
  const player = req.nextUrl.searchParams.get("player")?.toLowerCase();

  if (!supabase || !player) return Response.json(MOCK);

  const { data: winsData } = await supabase
    .from("wins")
    .select("day_utc,amount_units")
    .eq("lang", lang)
    .eq("player", player)
    .eq("claimed", false)
    .order("day_utc", { ascending: false });

  const wins = (winsData ?? []) as Array<{
    day_utc: string;
    amount_units: string | number;
  }>;

  if (wins.length === 0) return Response.json([]);

  // Pull day_number from pots for the claim() call.
  const { data: potsData } = await supabase
    .from("pots")
    .select("day_utc,day_number")
    .eq("lang", lang)
    .in(
      "day_utc",
      wins.map((w) => w.day_utc),
    );

  const dayNumByDate = new Map<string, number>();
  for (const p of (potsData ?? []) as Array<{
    day_utc: string;
    day_number: number;
  }>) {
    dayNumByDate.set(p.day_utc, p.day_number);
  }

  const unclaimed: UnclaimedWin[] = wins.map((w) => ({
    date: w.day_utc,
    amountUSD: Number(w.amount_units) / TOKEN_DECIMALS,
    dayNumber: dayNumByDate.get(w.day_utc) ?? 0,
  }));

  return Response.json(unclaimed);
}
