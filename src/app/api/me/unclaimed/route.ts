// All unclaimed wins for a wallet across every game (Grammar EN/ES,
// Math, plus whatever launches next). Originally scoped per-lang, but
// Math has lang=null so a lang-filtered query never matched its rows
// — yesterday's Math winner saw $0 to claim while the prize was sitting
// untouched on-chain. Now: one query, returns each win tagged with the
// game info the /you flow needs to call claimMultiple per game.

import type { NextRequest } from "next/server";
import { supabase, TOKEN_DECIMALS } from "@/lib/supabase";
import { readClaimedFlags } from "@/lib/onchain";

export const dynamic = "force-dynamic";

type UnclaimedWin = {
  date: string;
  amountUSD: number;
  dayNumber: number;
  game: "grammar" | "math";
  gameId: number;
  lang: "en" | "es" | null;
};

const MOCK: UnclaimedWin[] = [
  { date: "2026-04-15", amountUSD: 3.88, dayNumber: 12, game: "grammar", gameId: 1, lang: "en" },
];

export async function GET(req: NextRequest) {
  const player = req.nextUrl.searchParams.get("player")?.toLowerCase();

  if (!supabase || !player) return Response.json(MOCK);

  const { data: winsData } = await supabase
    .from("wins")
    .select("day_utc,amount_units,game,game_id,lang")
    .eq("player", player)
    .eq("claimed", false)
    .order("day_utc", { ascending: false });

  const wins = (winsData ?? []) as Array<{
    day_utc: string;
    amount_units: string | number;
    game: "grammar" | "math";
    game_id: number;
    lang: "en" | "es" | null;
  }>;

  if (wins.length === 0) return Response.json([]);

  // Pull the matching pots rows in one query so we can map day_utc →
  // day_number per (game_id, day_utc). The contract wants the on-chain
  // day_number, not the calendar date, so this lookup is essential
  // before we hit readClaimedFlags or hand anything to claimMultiple.
  const dayUtcs = [...new Set(wins.map((w) => w.day_utc))];
  const { data: potsData } = await supabase
    .from("pots")
    .select("day_utc,day_number,game_id")
    .in("day_utc", dayUtcs);

  const dayNumByKey = new Map<string, number>();
  for (const p of (potsData ?? []) as Array<{
    day_utc: string;
    day_number: number;
    game_id: number;
  }>) {
    dayNumByKey.set(`${p.game_id}:${p.day_utc}`, p.day_number);
  }

  // Verify on-chain: the DB only flips `claimed` when something tells
  // it to, but the actual claim() call has no indexer listening, so
  // the contract is the source of truth. Group day_numbers by game_id
  // for one readClaimedFlags call per game.
  const daysByGameId = new Map<number, Set<number>>();
  for (const w of wins) {
    const dn = dayNumByKey.get(`${w.game_id}:${w.day_utc}`);
    if (typeof dn === "number" && dn > 0) {
      if (!daysByGameId.has(w.game_id)) daysByGameId.set(w.game_id, new Set());
      daysByGameId.get(w.game_id)!.add(dn);
    }
  }

  const claimedFlagsByGameId = new Map<number, Record<number, boolean>>();
  await Promise.all(
    [...daysByGameId.entries()].map(async ([gid, daySet]) => {
      try {
        const flags = await readClaimedFlags(gid, [...daySet]);
        claimedFlagsByGameId.set(gid, flags);
      } catch (e) {
        console.warn(`readClaimedFlags failed for gameId=${gid}:`, e);
        claimedFlagsByGameId.set(gid, {});
      }
    }),
  );

  // Lazy-sync: flip DB rows the chain says are already claimed so the
  // banners on home and the totals on /you don't keep showing money
  // that's already been moved out. Group updates per (game_id) since
  // the wins table now keys on game_id, not lang.
  for (const [gid, flags] of claimedFlagsByGameId) {
    const datesToFlip = wins
      .filter((w) => w.game_id === gid)
      .filter((w) => {
        const dn = dayNumByKey.get(`${w.game_id}:${w.day_utc}`);
        return typeof dn === "number" && flags[dn] === true;
      })
      .map((w) => w.day_utc);
    if (datesToFlip.length > 0) {
      await supabase
        .from("wins")
        .update({ claimed: true })
        .eq("game_id", gid)
        .eq("player", player)
        .in("day_utc", datesToFlip);
    }
  }

  const unclaimed: UnclaimedWin[] = wins
    .filter((w) => {
      const dn = dayNumByKey.get(`${w.game_id}:${w.day_utc}`);
      const flags = claimedFlagsByGameId.get(w.game_id) ?? {};
      return typeof dn !== "number" || flags[dn] !== true;
    })
    .map((w) => ({
      date: w.day_utc,
      amountUSD: Number(w.amount_units) / TOKEN_DECIMALS,
      dayNumber: dayNumByKey.get(`${w.game_id}:${w.day_utc}`) ?? 0,
      game: w.game,
      gameId: w.game_id,
      lang: w.lang,
    }));

  return Response.json(unclaimed);
}
