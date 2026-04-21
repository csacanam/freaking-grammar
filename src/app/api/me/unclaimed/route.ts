import type { NextRequest } from "next/server";
import { validateLang, gameIdFor } from "@/lib/i18n";
import { supabase, TOKEN_DECIMALS } from "@/lib/supabase";
import { readClaimedFlags } from "@/lib/onchain";

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

  const dayNumbers = Array.from(
    new Set(
      wins
        .map((w) => dayNumByDate.get(w.day_utc))
        .filter((n): n is number => typeof n === "number" && n > 0),
    ),
  );

  // Verify on-chain: the DB only flips `claimed` when something tells it to,
  // but the actual claim() call has no indexer listening. Trust the chain.
  let claimedFlags: Record<number, boolean> = {};
  try {
    if (dayNumbers.length > 0) {
      claimedFlags = await readClaimedFlags(gameIdFor(lang), dayNumbers);
    }
  } catch (e) {
    console.warn("readClaimedFlags failed, falling back to DB truth:", e);
  }

  // Lazy-sync: mark DB rows that chain says are claimed so subsequent calls
  // skip the RPC work and the other views (home banner, /you stats) clear too.
  const claimedDates = wins
    .filter((w) => {
      const dn = dayNumByDate.get(w.day_utc);
      return typeof dn === "number" && claimedFlags[dn] === true;
    })
    .map((w) => w.day_utc);
  if (claimedDates.length > 0) {
    await supabase
      .from("wins")
      .update({ claimed: true })
      .eq("lang", lang)
      .eq("player", player)
      .in("day_utc", claimedDates);
  }

  const unclaimed: UnclaimedWin[] = wins
    .filter((w) => {
      const dn = dayNumByDate.get(w.day_utc);
      return typeof dn !== "number" || claimedFlags[dn] !== true;
    })
    .map((w) => ({
      date: w.day_utc,
      amountUSD: Number(w.amount_units) / TOKEN_DECIMALS,
      dayNumber: dayNumByDate.get(w.day_utc) ?? 0,
    }));

  return Response.json(unclaimed);
}
