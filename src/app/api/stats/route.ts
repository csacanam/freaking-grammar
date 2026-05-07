// Public JSON feed for external dashboards (e.g. sakalabs.io). Returns the
// same metrics the /stats page shows, plus live on-chain treasury state per
// game. CORS is wide open — this is all public protocol data.

import { isAddressEqual, zeroAddress } from "viem";
import { supabase, TOKEN_DECIMALS } from "@/lib/supabase";
import { POT_ADDRESS } from "@/lib/chain";
import { celoClient, FREAKING_POT_ABI, readTreasuryState } from "@/lib/onchain";

export const dynamic = "force-dynamic";

const ENTRY_FEE_USD = 0.1;
const PROTOCOL_CUT_USD = (ENTRY_FEE_USD * 2000) / 10_000; // 20%

// All three live games keyed for the public feed. `key` is the
// stable identifier consumers can group by; the `games` map in the
// response is keyed by it. id = on-chain gameId in the FreakingPot
// contract.
type GameKey = "grammar-en" | "grammar-es" | "math";
const GAMES: { id: number; key: GameKey; game: "grammar" | "math"; lang: "en" | "es" | null }[] = [
  { id: 1, key: "grammar-en", game: "grammar", lang: "en" },
  { id: 2, key: "grammar-es", game: "grammar", lang: "es" },
  { id: 3, key: "math",       game: "math",    lang: null },
];

function gameKeyOf(row: { game?: string | null; lang: string | null }): GameKey | null {
  if (row.game === "math") return "math";
  if (row.lang === "en") return "grammar-en";
  if (row.lang === "es") return "grammar-es";
  return null;
}

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

  const [
    { data: runsData },
    { data: winsData },
    { data: potsData },
  ] = await Promise.all([
    supabase.from("runs").select("lang,game,player,was_free"),
    supabase.from("wins").select("lang,game,amount_units"),
    supabase.from("pots").select("lang,game,amount_units,closed"),
  ]);

  const runs = (runsData ?? []) as Array<{
    lang: string | null;
    game: string | null;
    player: string;
    was_free: boolean;
  }>;
  const wins = (winsData ?? []) as Array<{
    lang: string | null;
    game: string | null;
    amount_units: string | number;
  }>;
  const pots = (potsData ?? []) as Array<{
    lang: string | null;
    game: string | null;
    amount_units: string | number;
    closed: boolean;
  }>;

  type GameAgg = {
    plays: number;
    paid: number;
    players: number;
    revenueUSD: number;
    distributedUSD: number;
  };
  const byGame: Record<GameKey, GameAgg> = {
    "grammar-en": { plays: 0, paid: 0, players: 0, revenueUSD: 0, distributedUSD: 0 },
    "grammar-es": { plays: 0, paid: 0, players: 0, revenueUSD: 0, distributedUSD: 0 },
    "math":       { plays: 0, paid: 0, players: 0, revenueUSD: 0, distributedUSD: 0 },
  };
  const playersByGame: Record<GameKey, Set<string>> = {
    "grammar-en": new Set(),
    "grammar-es": new Set(),
    "math": new Set(),
  };
  const allPlayers = new Set<string>();

  let paidPlays = 0;
  let freePlays = 0;
  for (const r of runs) {
    const k = gameKeyOf(r);
    if (!k) continue;
    byGame[k].plays++;
    playersByGame[k].add(r.player);
    allPlayers.add(r.player);
    if (r.was_free) freePlays++;
    else {
      paidPlays++;
      byGame[k].paid++;
    }
  }
  for (const g of GAMES) {
    byGame[g.key].players = playersByGame[g.key].size;
    byGame[g.key].revenueUSD = byGame[g.key].paid * PROTOCOL_CUT_USD;
  }

  let totalDistributedUSD = 0;
  for (const w of wins) {
    const k = gameKeyOf(w);
    if (!k) continue;
    const usd = Number(w.amount_units) / TOKEN_DECIMALS;
    byGame[k].distributedUSD += usd;
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

  // Live on-chain per-game state. Keyed by the public GameKey so
  // dashboards can pivot directly without remembering the contract id.
  const games: Record<
    GameKey,
    {
      contractId: number;
      game: "grammar" | "math";
      lang: "en" | "es" | null;
      currentPotUSD: number;
      treasuryUSD: number;
      runwayDays: number;
      dailySeedUSD: number;
    }
  > = {} as never;
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
          games[g.key] = {
            contractId: g.id,
            game: g.game,
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
      byGame,
      games,
      contract: isAddressEqual(POT_ADDRESS, zeroAddress) ? null : POT_ADDRESS,
      entryFeeUSD: ENTRY_FEE_USD,
      protocolFeePct: 20,
      updatedAt: new Date().toISOString(),
    },
    { headers: CORS },
  );
}
