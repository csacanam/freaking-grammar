import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Server-only Supabase client with the service-role key. `null` when env is
// missing so API routes can fall back to demo data without crashing.
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const supabase: SupabaseClient | null =
  url && key
    ? createClient(url, key, { auth: { persistSession: false } })
    : null;

export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export function nextUtcMidnightIso(): string {
  const d = new Date();
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1),
  ).toISOString();
}

// USDT has 6 decimals — same on Celo and Base.
export const TOKEN_DECIMALS = 1_000_000;

// Rank = 1 + number of distinct players with a strictly better best score today.
// Ties share a rank, and the current player is included using `score` when they
// don't have a higher score stored yet (mid-run).
//
// `scope` describes which leaderboard to count against:
//   { game: 'grammar', lang: 'en' | 'es' } → Grammar EN or ES specifically
//   { game: 'math' }                       → Math (no language)
//
// The previous lang-only signature is kept as a thin wrapper for the
// existing Grammar callers so this change doesn't ripple.
export async function computeRank(
  scope: { game: "grammar"; lang: "en" | "es" } | { game: "math" },
  day: string,
  player: string,
  score: number,
): Promise<number> {
  if (!supabase) return 0;
  let q = supabase
    .from("runs")
    .select("player,score")
    .eq("game", scope.game)
    .eq("day_utc", day)
    .eq("status", "finished");
  if (scope.game === "grammar") q = q.eq("lang", scope.lang);
  const { data } = await q;

  const bestByPlayer = new Map<string, number>();
  for (const r of (data ?? []) as Array<{ player: string; score: number }>) {
    const cur = bestByPlayer.get(r.player) ?? -1;
    if (r.score > cur) bestByPlayer.set(r.player, r.score);
  }
  const myBest = Math.max(bestByPlayer.get(player) ?? 0, score);

  let rank = 1;
  for (const [p, s] of bestByPlayer) {
    if (p === player) continue;
    if (s > myBest) rank++;
  }
  return rank;
}
