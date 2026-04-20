// Public JSON feed for external dashboards (e.g. sakalabs.io). Returns the
// same metrics the /stats page shows, plus live on-chain treasury state per
// game. CORS is wide open — this is all public protocol data.

import { isAddressEqual, zeroAddress } from "viem";
import { supabase, TOKEN_DECIMALS } from "@/lib/supabase";
import { POT_ADDRESS } from "@/lib/chain";
import { celoClient, FREAKING_POT_ABI, readTreasuryState } from "@/lib/onchain";
import type { Lang } from "@/lib/i18n";

export const dynamic = "force-dynamic";

const ENTRY_FEE_USD = 0.1;
const PROTOCOL_CUT_USD = (ENTRY_FEE_USD * 2000) / 10_000; // 20%

const GAMES: { id: 1 | 2; lang: Lang }[] = [
  { id: 1, lang: "en" },
  { id: 2, lang: "es" },
];

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function GET() {
  if (!supabase) {
    return Response.json({ error: "db-unconfigured" }, {
      status: 503,
      headers: CORS,
    });
  }

  const [{ data: runsData }, { data: winsData }, { data: potsData }] =
    await Promise.all([
      supabase.from("runs").select("lang,player,was_free"),
      supabase.from("wins").select("lang,amount_units"),
      supabase.from("pots").select("lang,amount_units,closed"),
    ]);

  const runs = (runsData ?? []) as Array<{
    lang: Lang;
    player: string;
    was_free: boolean;
  }>;
  const wins = (winsData ?? []) as Array<{
    lang: Lang;
    amount_units: string | number;
  }>;
  const pots = (potsData ?? []) as Array<{
    lang: Lang;
    amount_units: string | number;
    closed: boolean;
  }>;

  type LangAgg = {
    plays: number;
    paid: number;
    players: number;
    revenueUSD: number;
    distributedUSD: number;
  };
  const byLang: Record<Lang, LangAgg> = {
    en: { plays: 0, paid: 0, players: 0, revenueUSD: 0, distributedUSD: 0 },
    es: { plays: 0, paid: 0, players: 0, revenueUSD: 0, distributedUSD: 0 },
  };
  const playersByLang: Record<Lang, Set<string>> = {
    en: new Set(),
    es: new Set(),
  };
  const allPlayers = new Set<string>();

  let paidPlays = 0;
  let freePlays = 0;
  for (const r of runs) {
    if (r.lang !== "en" && r.lang !== "es") continue;
    byLang[r.lang].plays++;
    playersByLang[r.lang].add(r.player);
    allPlayers.add(r.player);
    if (r.was_free) freePlays++;
    else {
      paidPlays++;
      byLang[r.lang].paid++;
    }
  }
  for (const l of ["en", "es"] as const) {
    byLang[l].players = playersByLang[l].size;
    byLang[l].revenueUSD = byLang[l].paid * PROTOCOL_CUT_USD;
  }

  let totalDistributedUSD = 0;
  for (const w of wins) {
    if (w.lang !== "en" && w.lang !== "es") continue;
    const usd = Number(w.amount_units) / TOKEN_DECIMALS;
    byLang[w.lang].distributedUSD += usd;
    totalDistributedUSD += usd;
  }

  let daysClosed = 0;
  let biggestPotUSD = 0;
  for (const p of pots) {
    if (!p.closed) continue;
    daysClosed++;
    const usd = Number(p.amount_units) / TOKEN_DECIMALS;
    if (usd > biggestPotUSD) biggestPotUSD = usd;
  }

  // Live on-chain per-game state.
  const games: Record<
    string,
    {
      lang: Lang;
      currentPotUSD: number;
      treasuryUSD: number;
      runwayDays: number;
      dailySeedUSD: number;
    }
  > = {};
  if (!isAddressEqual(POT_ADDRESS, zeroAddress)) {
    await Promise.all(
      GAMES.map(async (g) => {
        try {
          const [{ treasury, dailySeed }, day] = await Promise.all([
            readTreasuryState(g.id),
            celoClient.readContract({
              address: POT_ADDRESS,
              abi: FREAKING_POT_ABI,
              functionName: "currentDay",
              args: [BigInt(g.id)],
            }) as Promise<bigint>,
          ]);
          const pot = (await celoClient.readContract({
            address: POT_ADDRESS,
            abi: FREAKING_POT_ABI,
            functionName: "viewPot",
            args: [BigInt(g.id), day],
          })) as bigint;
          const treasuryUSD = Number(treasury) / TOKEN_DECIMALS;
          const dailySeedUSD = Number(dailySeed) / TOKEN_DECIMALS;
          games[String(g.id)] = {
            lang: g.lang,
            currentPotUSD: Number(pot) / TOKEN_DECIMALS,
            treasuryUSD,
            dailySeedUSD,
            runwayDays: dailySeedUSD > 0 ? treasuryUSD / dailySeedUSD : 0,
          };
        } catch {
          /* skip on RPC failure */
        }
      }),
    );
  }

  return Response.json(
    {
      revenueUSD: paidPlays * PROTOCOL_CUT_USD,
      totalPlays: runs.length,
      paidPlays,
      freePlays,
      uniquePlayers: allPlayers.size,
      daysClosed,
      totalDistributedUSD,
      biggestPotUSD,
      byLang,
      games,
      contract: isAddressEqual(POT_ADDRESS, zeroAddress) ? null : POT_ADDRESS,
      entryFeeUSD: ENTRY_FEE_USD,
      protocolFeePct: 20,
      updatedAt: new Date().toISOString(),
    },
    { headers: CORS },
  );
}
