import { supabase, TOKEN_DECIMALS } from "@/lib/supabase";
import { fmtUSD } from "@/lib/format";

export const dynamic = "force-dynamic";

const ENTRY_FEE_USD = 0.1;
const PROTOCOL_BPS = 2000; // 20%
const PROTOCOL_CUT_USD = (ENTRY_FEE_USD * PROTOCOL_BPS) / 10_000;

type Stats = {
  revenueUSD: number;
  totalPlays: number;
  paidPlays: number;
  freePlays: number;
  uniquePlayers: number;
  daysClosed: number;
  totalDistributedUSD: number;
  biggestPotUSD: number;
  byLang: Record<"en" | "es", {
    plays: number;
    paid: number;
    players: number;
    revenueUSD: number;
    distributedUSD: number;
  }>;
};

async function loadStats(): Promise<Stats | null> {
  if (!supabase) return null;

  const [
    { data: runsData },
    { data: winsData },
    { data: potsData },
  ] = await Promise.all([
    supabase.from("runs").select("lang,player,was_free"),
    supabase.from("wins").select("lang,amount_units"),
    supabase.from("pots").select("lang,amount_units,closed"),
  ]);

  const runs = (runsData ?? []) as Array<{
    lang: "en" | "es";
    player: string;
    was_free: boolean;
  }>;
  const wins = (winsData ?? []) as Array<{
    lang: "en" | "es";
    amount_units: string | number;
  }>;
  const pots = (potsData ?? []) as Array<{
    lang: "en" | "es";
    amount_units: string | number;
    closed: boolean;
  }>;

  const byLang: Stats["byLang"] = {
    en: { plays: 0, paid: 0, players: 0, revenueUSD: 0, distributedUSD: 0 },
    es: { plays: 0, paid: 0, players: 0, revenueUSD: 0, distributedUSD: 0 },
  };
  const playersByLang: Record<"en" | "es", Set<string>> = { en: new Set(), es: new Set() };

  let paidPlays = 0;
  let freePlays = 0;
  const allPlayers = new Set<string>();

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

  return {
    revenueUSD: paidPlays * PROTOCOL_CUT_USD,
    totalPlays: runs.length,
    paidPlays,
    freePlays,
    uniquePlayers: allPlayers.size,
    daysClosed,
    totalDistributedUSD,
    biggestPotUSD,
    byLang,
  };
}

export default async function StatsPage() {
  const stats = await loadStats();

  return (
    <div className="flex-1 flex flex-col px-5 pt-6 pb-10 max-w-3xl mx-auto w-full gap-6">
      <header>
        <h1 className="font-display text-4xl tracking-wider">Stats</h1>
        <p className="text-xs font-mono text-muted mt-1">
          Live from Supabase · refresh to update
        </p>
      </header>

      {!stats ? (
        <div className="rounded-2xl bg-white border border-dashed border-black/10 p-8 text-center text-muted text-sm">
          Supabase not configured.
        </div>
      ) : (
        <>
          <section className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Tile label="Revenue" value={fmtUSD(stats.revenueUSD)} accent="bg-teal/20" />
            <Tile label="Pot paid out" value={fmtUSD(stats.totalDistributedUSD)} accent="bg-yellow/40" />
            <Tile label="Biggest pot" value={fmtUSD(stats.biggestPotUSD)} accent="bg-orange/30" />
            <Tile label="Total plays" value={stats.totalPlays.toString()} accent="bg-blue/10" />
            <Tile label="Paid plays" value={stats.paidPlays.toString()} accent="bg-purple/20" />
            <Tile label="Unique players" value={stats.uniquePlayers.toString()} accent="bg-pink/20" />
          </section>

          <section className="rounded-3xl bg-white border border-black/5 p-5 shadow-[0_4px_0_0_rgba(0,0,0,0.04)]">
            <h2 className="font-display text-2xl mb-3">By language</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted font-display text-xs tracking-widest uppercase">
                  <th className="py-2">Lang</th>
                  <th className="py-2 text-right">Plays</th>
                  <th className="py-2 text-right">Paid</th>
                  <th className="py-2 text-right">Players</th>
                  <th className="py-2 text-right">Revenue</th>
                  <th className="py-2 text-right">Paid out</th>
                </tr>
              </thead>
              <tbody>
                {(["en", "es"] as const).map((l) => (
                  <tr key={l} className="border-t border-black/5">
                    <td className="py-2 font-display uppercase">{l}</td>
                    <td className="py-2 text-right tabular-nums">{stats.byLang[l].plays}</td>
                    <td className="py-2 text-right tabular-nums">{stats.byLang[l].paid}</td>
                    <td className="py-2 text-right tabular-nums">{stats.byLang[l].players}</td>
                    <td className="py-2 text-right tabular-nums">{fmtUSD(stats.byLang[l].revenueUSD)}</td>
                    <td className="py-2 text-right tabular-nums">{fmtUSD(stats.byLang[l].distributedUSD)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="text-xs text-muted font-mono">
            <p>Entry fee: {fmtUSD(ENTRY_FEE_USD)} · Protocol cut: 20% ({fmtUSD(PROTOCOL_CUT_USD)}/play)</p>
            <p>Days closed: {stats.daysClosed} · Free plays: {stats.freePlays}</p>
          </section>
        </>
      )}
    </div>
  );
}

function Tile({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className={`${accent} rounded-2xl px-4 py-4`}>
      <div className="text-[10px] font-display tracking-widest uppercase text-muted leading-tight">
        {label}
      </div>
      <div className="font-display text-3xl mt-1 tabular-nums">{value}</div>
    </div>
  );
}
