// Two-layer bot filter used by `roll-day` when picking the daily winner.
// Layer 1: a DB-backed blocklist (`bot_wallets` table). Seeded with the
// six wallets we identified by hand (one operator, all sharing the same
// impossibly uniform ~1.5–2.0s response timing and 100% correctness
// across hundreds of answers). Layer 2: a stats heuristic that fires on
// any new wallet matching the same signature — and *persists* the hit
// back into `bot_wallets` so future settlements short-circuit on layer 1.
//
// Heuristic threshold: correctRate ≥ 99% AND p50 < 2400ms.
// Calibrated against ~12 confirmed humans (correctRate 67–86%, p50
// 2637–3833ms) and 6 confirmed bots (correctRate 99.7–100%, p50
// 1510–2095ms). Gap between bot p50 max (2095) and human p50 min
// (2637) is 542ms — wide enough that minimum-sample noise won't push
// a real human across.
//
// Min sample of 30 timed answers (q_index > 0, answered_at not null,
// from non-open runs) keeps the heuristic from misfiring on a single
// lucky session.

import type { SupabaseClient } from "@supabase/supabase-js";

const MIN_SAMPLE = 30;
const HEURISTIC_LOOKBACK_DAYS = 30;
const HEURISTIC_CORRECT_RATE_MIN = 0.99;
const HEURISTIC_P50_MAX_MS = 2400;

export type BotFlag =
  | { flagged: false }
  | { flagged: true; reason: "blacklist" }
  | {
      flagged: true;
      reason: "heuristic";
      correctRate: number;
      p50ms: number;
      sampleSize: number;
    };

// Pull the full `bot_wallets` blacklist once per settlement so the
// per-candidate check is a Set lookup. The table is small (one row per
// flagged wallet, never expires unless removed) so this is cheap.
export async function loadBotBlacklist(
  supabase: SupabaseClient,
): Promise<Set<string>> {
  const { data } = await supabase.from("bot_wallets").select("player");
  const rows = (data ?? []) as Array<{ player: string }>;
  return new Set(rows.map((r) => r.player.toLowerCase()));
}

export async function checkBotPlayer(
  player: string,
  supabase: SupabaseClient,
  blacklist?: Set<string>,
  scope?: { game?: "grammar" | "math" },
): Promise<BotFlag> {
  const addr = player.toLowerCase();

  // Hot path: caller passed a preloaded blacklist (e.g., roll-day after
  // loadBotBlacklist). Otherwise hit the DB for this single wallet —
  // fine for ad-hoc admin spot-checks but avoid in tight loops.
  const isBlacklisted = blacklist
    ? blacklist.has(addr)
    : await isWalletBlacklisted(addr, supabase);
  if (isBlacklisted) {
    return { flagged: true, reason: "blacklist" };
  }

  // Math heuristic is intentionally disabled. Empirical sweep on
  // 2026-05-07 showed Math p50 distributions for confirmed bots
  // (~2016ms pooled, n=15) and confirmed humans (~1990ms pooled, n=31)
  // are statistically indistinguishable — the tight 1.5–2.5s clock
  // forces every player toward the budget floor, collapsing the gap
  // that makes Grammar's heuristic reliable. Flagging on Math timing
  // alone would generate false positives. Bots that play Grammar AND
  // Math still get caught via Grammar (and the blacklist propagates
  // globally), so we lose only the rare Math-only bot — which is
  // unlikely given the picker exposes all games. Revisit when we
  // have ≥30 days of Math human data to recalibrate.
  if (scope?.game === "math") {
    return { flagged: false };
  }

  const since = new Date(
    Date.now() - HEURISTIC_LOOKBACK_DAYS * 86_400_000,
  ).toISOString();

  // Scope to one game when caller provides it. Grammar and Math have
  // different natural timing distributions (Grammar reads phrases ~3s,
  // Math reads tiny equations ~1.5s), so mixing the two would muddy
  // the heuristic — a fast Math player could push their pooled p50
  // below the threshold and escape detection on Grammar.
  let q = supabase
    .from("run_questions")
    .select(
      "q_index,served_at,answered_at,answer_correct,runs!inner(player,status,game)",
    )
    .eq("runs.player", addr)
    .gte("served_at", since)
    .gt("q_index", 0) // q_index 0 has no timer; not useful for fingerprinting
    .neq("runs.status", "open")
    .limit(2000);
  if (scope?.game) q = q.eq("runs.game", scope.game);
  const { data } = await q;

  type Row = {
    served_at: string;
    answered_at: string | null;
    answer_correct: boolean | null;
  };
  const rows = (data ?? []) as unknown as Row[];

  let correct = 0;
  let answered = 0;
  const timedMs: number[] = [];
  for (const r of rows) {
    if (r.answered_at === null) continue;
    answered++;
    if (r.answer_correct === true) correct++;
    const ms =
      new Date(r.answered_at).getTime() - new Date(r.served_at).getTime();
    if (ms >= 0 && ms <= 10_000) timedMs.push(ms);
  }

  if (answered < MIN_SAMPLE || timedMs.length < MIN_SAMPLE) {
    return { flagged: false };
  }

  const correctRate = correct / answered;
  timedMs.sort((a, b) => a - b);
  const p50 = timedMs[Math.floor(timedMs.length * 0.5)];

  if (
    correctRate >= HEURISTIC_CORRECT_RATE_MIN &&
    p50 < HEURISTIC_P50_MAX_MS
  ) {
    // Persist so future runs hit the blacklist short-circuit. Upsert on
    // primary key keeps it idempotent if multiple langs flag the same
    // wallet on the same settlement, and intentionally does NOT overwrite
    // older flagged_at / reason — once flagged, stays flagged with the
    // original context until manually removed.
    // We got past the blacklist check, so this wallet is being flagged
    // for the first time RIGHT NOW. Persist silently — the caller
    // (roll-day) rolls every new flag into a single settlement summary
    // Telegram. Errors here are non-fatal: still return the flag so
    // settlement can keep going.
    const { error } = await supabase.from("bot_wallets").upsert(
      {
        player: addr,
        reason: "heuristic",
        correct_rate: correctRate,
        p50_ms: p50,
        sample_size: timedMs.length,
      },
      { onConflict: "player", ignoreDuplicates: true },
    );
    if (error) {
      console.error("bot-detection: upsert failed (non-fatal):", error);
    }

    // Mutate the in-memory blacklist so the same settlement run doesn't
    // re-check this wallet across pages.
    blacklist?.add(addr);

    return {
      flagged: true,
      reason: "heuristic",
      correctRate,
      p50ms: p50,
      sampleSize: timedMs.length,
    };
  }

  return { flagged: false };
}

async function isWalletBlacklisted(
  addr: string,
  supabase: SupabaseClient,
): Promise<boolean> {
  const { data } = await supabase
    .from("bot_wallets")
    .select("player")
    .eq("player", addr)
    .maybeSingle();
  return !!data;
}

// Fire-and-forget Telegram heads-up when a wallet on the blacklist
// pays for a play. We deliberately ignore free plays — those don't
// drain the pot and would just spam the channel.
//
// Dedup: only the FIRST paid play of the day per (player) triggers a
// message. Same wallet paying 30 times → one alert, not 30. We detect
// "first" by checking how many paid runs already exist today for this
// player; this function is called BEFORE the new run is inserted, so
// "0 existing" means the about-to-be-inserted play is the day's first.
//
// Errors are swallowed so a failing alert never blocks a real play. No
// re-throws, no awaiting from the hot path — call sites use a fire-
// and-forget pattern (no `await`) and let the runtime handle it.
export async function maybeAlertBotPlay(args: {
  player: string;
  gameLabel: string;
  wasFree: boolean;
  day: string;
  supabase: SupabaseClient;
  sendTelegram: (text: string) => Promise<boolean>;
}): Promise<void> {
  const { player, gameLabel, wasFree, day, supabase, sendTelegram } = args;
  if (wasFree) return;
  try {
    const addr = player.toLowerCase();
    const flagged = await isWalletBlacklisted(addr, supabase);
    if (!flagged) return;

    const { count } = await supabase
      .from("runs")
      .select("*", { count: "exact", head: true })
      .eq("player", addr)
      .eq("day_utc", day)
      .eq("was_free", false);
    if ((count ?? 0) > 0) return; // already alerted today (or earlier paid play exists)

    const short = `${addr.slice(0, 6)}…${addr.slice(-4)}`;
    const text = [
      "*🤖 Bot wallet paid for a play*",
      "",
      `Game: *${gameLabel}*`,
      `Wallet: \`${addr}\` (${short})`,
      `Day: ${day}`,
      "",
      "Settlement will skip this wallet at roll-day; alerting because the entry fee still lands in the pot. First paid play of the day — further plays today are silent.",
    ].join("\n");
    await sendTelegram(text);
  } catch (e) {
    console.error("maybeAlertBotPlay: failed (non-fatal):", e);
  }
}
