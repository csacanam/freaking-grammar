// Past Freaking Math pots, newest first. Mirror of /api/history (Grammar)
// but scoped to game='math'. No language filter — Math has one global
// pot regardless of UI language.

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

export async function GET() {
  if (!supabase) return Response.json([] as HistoryDay[]);

  const { data: potsData } = await supabase
    .from("pots")
    .select("day_utc,amount_units,winner,winner_score")
    .eq("game", "math")
    .eq("closed", true)
    .order("day_utc", { ascending: false })
    .limit(30);

  const pots = (potsData ?? []) as Array<{
    day_utc: string;
    amount_units: string | number;
    winner: string | null;
    winner_score: number | null;
  }>;

  // Bonus payouts joined client-side so we don't need a Postgres view.
  const days = pots.map((p) => p.day_utc);
  const bonusesByDay = new Map<string, HistoryBonus[]>();
  if (days.length > 0) {
    const { data: payoutsData } = await supabase
      .from("sponsor_payouts")
      .select(
        "day_utc,amount_units,campaign:sponsor_campaigns(name,emoji,token_symbol,token_decimals)",
      )
      .eq("game_id", 3)
      .in("day_utc", days);
    type CampaignEmbed = {
      name: string;
      emoji: string | null;
      token_symbol: string;
      token_decimals: number;
    };
    type Row = {
      day_utc: string;
      amount_units: string | number;
      campaign: CampaignEmbed | CampaignEmbed[] | null;
    };
    for (const p of (payoutsData ?? []) as Row[]) {
      const camp = Array.isArray(p.campaign) ? p.campaign[0] : p.campaign;
      if (!camp) continue;
      const list = bonusesByDay.get(p.day_utc) ?? [];
      list.push({
        sponsor: camp.name,
        emoji: camp.emoji,
        amount: Number(p.amount_units) / 10 ** camp.token_decimals,
        tokenSymbol: camp.token_symbol,
      });
      bonusesByDay.set(p.day_utc, list);
    }
  }

  const out: HistoryDay[] = pots.map((p) => ({
    date: p.day_utc,
    potUSD: Number(p.amount_units) / TOKEN_DECIMALS,
    winner: p.winner,
    winnerScore: p.winner_score,
    bonuses: bonusesByDay.get(p.day_utc),
  }));

  return Response.json(out);
}
