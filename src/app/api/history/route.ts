import type { NextRequest } from "next/server";
import { validateLang } from "@/lib/i18n";
import { supabase, TOKEN_DECIMALS } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type HistoryBonus = {
  sponsor: string;
  emoji: string | null;
  amount: number;
  tokenSymbol: string;
};

type HistoryDay = {
  date: string;
  potUSD: number;
  winner: string | null;
  winnerScore: number | null;
  bonuses?: HistoryBonus[];
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

  const { data: potsData } = await supabase
    .from("pots")
    .select("day_utc,amount_units,winner,winner_score")
    .eq("lang", lang)
    .eq("closed", true)
    .order("day_utc", { ascending: false })
    .limit(30);

  const pots = (potsData ?? []) as Array<{
    day_utc: string;
    amount_units: string | number;
    winner: string | null;
    winner_score: number | null;
  }>;

  // Pull bonus payouts for these days in one shot — join client-side so we
  // don't need a Postgres view. Lists each sponsor's contribution inline
  // with the day's pot so the UI can render a single "what you won" block.
  const days = pots.map((p) => p.day_utc);
  let bonusesByDay = new Map<string, HistoryBonus[]>();
  if (days.length > 0) {
    const { data: payoutsData } = await supabase
      .from("sponsor_payouts")
      .select(
        "day_utc,amount_units,campaign:sponsor_campaigns(name,emoji,token_symbol,token_decimals)",
      )
      .eq("lang", lang)
      .in("day_utc", days);
    // PostgREST returns the embedded FK as an array even when it's 1:1.
    type CampaignEmbed = {
      name: string;
      emoji: string | null;
      token_symbol: string;
      token_decimals: number;
    };
    const payouts = (payoutsData ?? []) as unknown as Array<{
      day_utc: string;
      amount_units: string | number;
      campaign: CampaignEmbed | CampaignEmbed[] | null;
    }>;
    bonusesByDay = payouts.reduce((acc, p) => {
      const camp = Array.isArray(p.campaign) ? p.campaign[0] : p.campaign;
      if (!camp) return acc;
      const arr = acc.get(p.day_utc) ?? [];
      arr.push({
        sponsor: camp.name,
        emoji: camp.emoji,
        amount: Number(p.amount_units) / 10 ** camp.token_decimals,
        tokenSymbol: camp.token_symbol,
      });
      acc.set(p.day_utc, arr);
      return acc;
    }, new Map<string, HistoryBonus[]>());
  }

  const history: HistoryDay[] = pots.map((row) => ({
    date: row.day_utc,
    potUSD: Number(row.amount_units) / TOKEN_DECIMALS,
    winner: row.winner,
    winnerScore: row.winner_score,
    bonuses: bonusesByDay.get(row.day_utc),
  }));

  return Response.json(history);
}
