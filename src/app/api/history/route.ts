import type { NextRequest } from "next/server";
import { validateLang } from "@/lib/i18n";
import { supabase, TOKEN_DECIMALS } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type HistoryDay = {
  date: string;
  potUSD: number;
  winner: string | null;
  winnerScore: number | null;
};

const MOCK: HistoryDay[] = [
  {
    date: "2026-04-18",
    potUSD: 4.32,
    winner: "0xa11ce00000000000000000000000000000001234",
    winnerScore: 62,
  },
  {
    date: "2026-04-17",
    potUSD: 2.1,
    winner: "0x4a81a00000000000000000000000000000ab1200",
    winnerScore: 51,
  },
  { date: "2026-04-16", potUSD: 1.05, winner: null, winnerScore: null },
  {
    date: "2026-04-15",
    potUSD: 3.88,
    winner: "0xca1110000000000000000000000000000000ffff",
    winnerScore: 73,
  },
];

export async function GET(req: NextRequest) {
  const lang = validateLang(req.nextUrl.searchParams.get("lang"));
  if (!supabase) return Response.json(MOCK);

  const { data } = await supabase
    .from("pots")
    .select("day_utc,amount_units,winner,winner_score")
    .eq("lang", lang)
    .eq("closed", true)
    .order("day_utc", { ascending: false })
    .limit(30);

  const history: HistoryDay[] = (data ?? []).map(
    (row: {
      day_utc: string;
      amount_units: string | number;
      winner: string | null;
      winner_score: number | null;
    }) => ({
      date: row.day_utc,
      potUSD: Number(row.amount_units) / TOKEN_DECIMALS,
      winner: row.winner,
      winnerScore: row.winner_score,
    }),
  );

  return Response.json(history);
}
