// Two-layer bot filter used by `roll-day` when picking the daily winner.
// Layer 1: a DB-backed blocklist (`bot_wallets` table). Seeded with the
// six wallets we identified by hand (one operator, all sharing the same
// impossibly uniform ~1.5–2.0s response timing and 100% correctness
// across hundreds of answers). Layer 2: a stats heuristic that fires on
// any new wallet matching the same signature — and *persists* the hit
// back into `bot_wallets` so future settlements short-circuit on layer 1.
//
// The heuristic combines THREE gates over a minimum sample of timed answers:
//   1. correctness  — near-perfect accuracy
//   2. per-game p50 — median response time below a game-specific ceiling
//   3. timing spread — relative dispersion (p90-p10)/p50 below a ceiling
// Gate 3 is what separates a bot from a fast, accurate human. Bots answer
// metronomically: every question takes almost the same time regardless of
// difficulty, so their spread is tiny (~0.20). Humans vary — easy questions
// fast, hard ones slow — so even a strong human sits wide (0.5+). Without
// this gate a human whose p50 lands just under the ceiling at high accuracy
// gets false-flagged (observed: a real player, p50 2365ms vs 2400ms ceiling,
// 94% correct, but timings spread 1.7s→3.6s — unmistakably human).
//
// The OPERATIVE THRESHOLDS ARE READ FROM ENV — deliberately NOT hardcoded in
// this public repo. Attackers were reading the constants and tuning bots to
// sit just outside them; keeping the real values in the deployment env
// (private) removes that intel and lets ops re-tune without a public commit.
// The fallbacks below are conservative defaults for local/dev if the env vars
// are unset — set the real (and ideally tighter, and different) values in the
// production environment.
//
// This two-gate heuristic is only a backstop. The primary, public-safe
// defenses don't depend on secret thresholds: a hidden question bank (answers
// never leave the server), deterministic full-bank-clear auto-flagging, and
// server-side answer validation + timing — all of which hold even when the
// mechanism is fully known.

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllPaged } from "@/lib/supabase";

const MIN_SAMPLE = Number(process.env.BOT_MIN_SAMPLE ?? 30);
const HEURISTIC_LOOKBACK_DAYS = Number(process.env.BOT_LOOKBACK_DAYS ?? 30);
const HEURISTIC_CORRECT_RATE_MIN = Number(process.env.BOT_CORRECT_RATE_MIN ?? 0.99);

// Per-game p50 ceilings (ms). Grammar and Math have different natural timing
// distributions, so a single ceiling misclassifies. Values come from env.
const HEURISTIC_P50_MAX_MS: Record<"grammar" | "math", number> = {
  grammar: Number(process.env.BOT_P50_MAX_GRAMMAR_MS ?? 2400),
  math: Number(process.env.BOT_P50_MAX_MATH_MS ?? 800),
};
// Fallback for ad-hoc checks without a game scope: use the Grammar ceiling so
// the heuristic doesn't fire on a Math-fast human whose timing was pooled in.
const HEURISTIC_P50_MAX_MS_DEFAULT = Number(
  process.env.BOT_P50_MAX_GRAMMAR_MS ?? 2400,
);

// Max relative timing spread (p90-p10)/p50 to still count as botlike. A bot's
// spread is tiny (metronomic); a human's is wide. The flag fires only when the
// distribution is BELOW this ceiling (i.e., tight). Default is deliberately
// generous (excludes clear humans) — tighten in prod. Real bots observed
// ~0.20; the false-positive human was ~0.54.
const HEURISTIC_MAX_SPREAD = Number(process.env.BOT_MAX_TIMING_SPREAD ?? 0.35);

// Per-game best-score ceiling above which a near-perfect, large-sample run is
// treated as botlike regardless of timing spread — a backstop for games where
// timing alone doesn't separate bots from humans. Like every other threshold
// here, the operative values live in env; the fallbacks are deliberately high
// (effectively off) so local/dev never false-flags. Grammar's bank is finite
// and has its own full-clear flag, so its default is out of reach.
const HEURISTIC_SCORE_MAX: Record<"grammar" | "math", number> = {
  grammar: Number(process.env.BOT_SCORE_MAX_GRAMMAR ?? 999),
  math: Number(process.env.BOT_SCORE_MAX_MATH ?? 200),
};

// ---------------------------------------------------------- answer-key test
// Grammar-only, settlement-only. Score alone CANNOT separate an answer key
// from a returning player: the EN bank is finite (236), so someone who plays
// daily accumulates coverage and their max streak climbs on memory alone. A
// wallet at 188 with 198 of the bank already seen is a legitimate human; the
// old live score ceiling flagged it anyway.
//
// The discriminating signal is accuracy on questions the wallet has NEVER seen
// before. A real player is FLAT over time — their streak grows because more of
// the run is repeats, but their first-exposure accuracy stays where it always
// was (observed: 91–98%). An answer key jumps to ~100% on fresh questions with
// no history to explain it.
//
// We score that jump as a binomial z against the wallet's OWN historical fresh
// accuracy (or the population baseline when it has no history yet), rather
// than a fixed percentage gate — the same 100% means very different things
// over 30 fresh questions and over 236.
const KEY_MIN_FRESH = Number(process.env.BOT_KEY_MIN_FRESH ?? 25);
const KEY_MIN_HIST = Number(process.env.BOT_KEY_MIN_HIST ?? 20);
// Stand-in first-exposure accuracy for a wallet with no history of its own,
// and a FLOOR under every wallet's measured accuracy (see the baseline note in
// checkGrammarAnswerKey for why own history may only raise the bar).
//
// This is deliberately NOT the population mean. Measured over 226 unflagged EN
// players with 3+ runs (12.8k first-exposure answers): mean 85.5%, p90 91.9%,
// best single player 97.9%. Assuming the mean would flag every strong player on
// sight. The value here sits above the 90th percentile — i.e. we assume anyone
// we are about to judge is better than nearly the entire player base, and only
// call it a key when the run beats even that. Erring high costs us detections;
// erring low costs us real players, and only one of those two churns.
const KEY_BASELINE_ACC = Number(process.env.BOT_KEY_BASELINE_ACC ?? 0.96);
// How many standard deviations above baseline counts as key-like. Backtested
// against every wallet the old live ceiling flagged: everything the manual
// audit could explain as a human sits below one side of a clear gap, and the
// unexplained runs (a fresh address clearing essentially the whole bank) sit
// well above it. Public default is the conservative end — like every other
// threshold here, set the operative value in the prod env, not in this repo.
//
// Known residual: this cannot separate the very best humans from a key on a
// long perfect run — the gap between 97.9% (best measured player) and 100% is
// small, so a strong player who goes ~150 fresh questions without a miss can
// trip it. That run is rare (~4% of attempts even for that player) and it costs
// them one pot, not a ban, which is the trade this design deliberately makes.
const KEY_Z_MIN = Number(process.env.BOT_KEY_Z_MIN ?? 3.0);

export type BotFlag =
  | { flagged: false }
  | { flagged: true; reason: "blacklist" }
  | {
      flagged: true;
      reason: "heuristic";
      correctRate: number;
      p50ms: number;
      sampleSize: number;
      relSpread: number;
    }
  | {
      flagged: true;
      reason: "answer-key";
      freshN: number;
      freshCorrect: number;
      histN: number;
      baseline: number;
      z: number;
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

export type AnswerKeyVerdict = {
  keyLike: boolean;
  freshN: number;
  freshCorrect: number;
  histN: number;
  histAcc: number | null;
  baseline: number;
  z: number;
  diedOnOwnMiss: boolean;
  note: string;
};

type RunQuestionRow = {
  run_id: string;
  question_id: string;
  q_index: number;
  answer_correct: boolean | null;
};

// `.in()` on a huge id list blows past the URL limit, so chunk the run ids and
// page each chunk (a daily player accumulates thousands of answered questions).
async function fetchRunQuestions(
  runIds: string[],
  supabase: SupabaseClient,
): Promise<RunQuestionRow[]> {
  const out: RunQuestionRow[] = [];
  for (let i = 0; i < runIds.length; i += 200) {
    const chunk = runIds.slice(i, i + 200);
    const rows = await fetchAllPaged<RunQuestionRow>((from, to) =>
      supabase
        .from("run_questions")
        .select("run_id,question_id,q_index,answer_correct")
        .in("run_id", chunk)
        .range(from, to),
    );
    out.push(...rows);
  }
  return out;
}

// Judge ONE grammar run: does its first-exposure accuracy jump past what this
// wallet has ever shown before? Returns the full evidence either way so the
// settlement summary can show the numbers behind a skip.
export async function checkGrammarAnswerKey(
  player: string,
  runId: string,
  supabase: SupabaseClient,
): Promise<AnswerKeyVerdict> {
  const addr = player.toLowerCase();
  const inconclusive = (note: string): AnswerKeyVerdict => ({
    keyLike: false,
    freshN: 0,
    freshCorrect: 0,
    histN: 0,
    histAcc: null,
    baseline: 0,
    z: 0,
    diedOnOwnMiss: false,
    note,
  });

  const { data: runRow } = await supabase
    .from("runs")
    .select("id,lang,game,score,started_at")
    .eq("id", runId)
    .maybeSingle();
  const run = runRow as {
    id: string;
    lang: string;
    game: string;
    score: number | null;
    started_at: string;
  } | null;
  if (!run || run.game !== "grammar") return inconclusive("not-a-grammar-run");

  // Cheap exit before the expensive history walk. A run answers at most
  // score + 1 questions, so freshN <= score + 1, and z peaks when every fresh
  // answer is correct: z_max = sqrt(freshN * (1 - p) / p), rising with freshN
  // and falling with p. Since the baseline is floored at KEY_BASELINE_ACC, a
  // score below this bound provably cannot reach KEY_Z_MIN no matter what the
  // history turns out to be — so there is nothing to learn by fetching it.
  // Derived from the constants rather than hardcoded, so retuning the env
  // thresholds can't silently switch the test off.
  const maxScoreThatCannotFire =
    (KEY_Z_MIN * KEY_Z_MIN * KEY_BASELINE_ACC) / (1 - KEY_BASELINE_ACC) - 1;
  const runScore = run.score ?? 0;
  if (runScore < maxScoreThatCannotFire) {
    return inconclusive("score-below-detectable-floor");
  }

  // Prior finished runs on the SAME bank (the ES and EN banks are disjoint, so
  // ES history says nothing about which EN questions this wallet has seen).
  const priorRuns = await fetchAllPaged<{ id: string; started_at: string }>(
    (from, to) =>
      supabase
        .from("runs")
        .select("id,started_at")
        .eq("player", addr)
        .eq("game", "grammar")
        .eq("lang", run.lang)
        .eq("status", "finished")
        .lt("started_at", run.started_at)
        .order("started_at", { ascending: true })
        .range(from, to),
  );

  const startedAt = new Map(priorRuns.map((r) => [r.id, r.started_at]));
  const priorQs = await fetchRunQuestions(
    priorRuns.map((r) => r.id),
    supabase,
  );
  const runQs = await fetchRunQuestions([run.id], supabase);
  if (runQs.length === 0) return inconclusive("no-answers-on-run");

  // Walk prior answers in true chronological order so "first exposure" means
  // first exposure, and build the per-question record at the same time.
  const prior = new Map<string, { seen: number; correct: number }>();
  let histN = 0;
  let histCorrect = 0;
  const priorSorted = priorQs.slice().sort((a, b) => {
    const ta = startedAt.get(a.run_id) ?? "";
    const tb = startedAt.get(b.run_id) ?? "";
    return ta === tb ? a.q_index - b.q_index : ta < tb ? -1 : 1;
  });
  for (const q of priorSorted) {
    const seenBefore = prior.get(q.question_id);
    if (!seenBefore) {
      histN++;
      if (q.answer_correct === true) histCorrect++;
    }
    const rec = seenBefore ?? { seen: 0, correct: 0 };
    rec.seen++;
    if (q.answer_correct === true) rec.correct++;
    prior.set(q.question_id, rec);
  }

  let freshN = 0;
  let freshCorrect = 0;
  let diedOnOwnMiss = false;
  for (const q of runQs.slice().sort((a, b) => a.q_index - b.q_index)) {
    const rec = prior.get(q.question_id);
    if (!rec) {
      freshN++;
      if (q.answer_correct === true) freshCorrect++;
    }
    // Dying on a question this wallet has previously gotten wrong is a strong
    // human signal: a persistent blind spot is memorization, and an answer key
    // does not reproduce its own past mistakes.
    if (q.answer_correct === false && rec && rec.correct < rec.seen) {
      diedOnOwnMiss = true;
    }
  }

  const histAcc = histN >= KEY_MIN_HIST ? histCorrect / histN : null;
  // A wallet's own history can only RAISE the bar, never lower it. Own accuracy
  // measured over a few dozen questions is mostly noise, and letting a noisy-low
  // baseline stand makes an ordinary good run look damning: wallets with ~27-40
  // historical fresh answers scored 93% by chance, and using that as their bar
  // pushed a routine 96/96 to the same z as a brand-new address clearing 193/194
  // of the bank. Flooring collapses that false signal and opens a clean gap.
  // Also clamp at 0.995: p=1 has zero variance and would make every z infinite.
  const baseline = Math.min(
    0.995,
    Math.max(KEY_BASELINE_ACC, histAcc ?? KEY_BASELINE_ACC),
  );

  if (freshN < KEY_MIN_FRESH) {
    return {
      ...inconclusive("too-few-fresh-questions"),
      freshN,
      freshCorrect,
      histN,
      histAcc,
      baseline,
      diedOnOwnMiss,
    };
  }

  const sd = Math.sqrt(freshN * baseline * (1 - baseline));
  const z = sd > 0 ? (freshCorrect - freshN * baseline) / sd : 0;

  const keyLike = z >= KEY_Z_MIN && !diedOnOwnMiss;
  return {
    keyLike,
    freshN,
    freshCorrect,
    histN,
    histAcc,
    baseline,
    z,
    diedOnOwnMiss,
    note: keyLike
      ? "fresh-accuracy jump"
      : diedOnOwnMiss
        ? "died-on-own-miss"
        : "within-baseline",
  };
}

export async function checkBotPlayer(
  player: string,
  supabase: SupabaseClient,
  blacklist?: Set<string>,
  scope?: { game?: "grammar" | "math"; runId?: string },
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

  // Grammar answer-key test. Needs the specific candidate run, so it only ever
  // fires where the caller has one — settlement. The live answer path and the
  // periodic sweep pass no runId and are unaffected.
  //
  // Deliberately does NOT persist to `bot_wallets`: this verdict is about ONE
  // run, not the wallet. A wrong call costs the player a single pot instead of
  // a permanent, cross-game ban they can never see or appeal, which is the
  // right way round given a pot is small and a churned paying player is not.
  if (scope?.game === "grammar" && scope.runId) {
    const verdict = await checkGrammarAnswerKey(addr, scope.runId, supabase);
    if (verdict.keyLike) {
      return {
        flagged: true,
        reason: "answer-key",
        freshN: verdict.freshN,
        freshCorrect: verdict.freshCorrect,
        histN: verdict.histN,
        baseline: verdict.baseline,
        z: verdict.z,
      };
    }
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
  const p10 = timedMs[Math.floor(timedMs.length * 0.1)];
  const p50 = timedMs[Math.floor(timedMs.length * 0.5)];
  const p90 = timedMs[Math.floor(timedMs.length * 0.9)];

  // Relative timing spread. Robust to the odd network-lag outlier because it
  // uses p10/p90, not min/max. Bots are tight (~0.20); humans are wide (0.5+).
  // Guard p50 > 0 so a degenerate all-zero sample can't divide-by-zero.
  const relSpread = p50 > 0 ? (p90 - p10) / p50 : Infinity;

  const p50Ceiling = scope?.game
    ? HEURISTIC_P50_MAX_MS[scope.game]
    : HEURISTIC_P50_MAX_MS_DEFAULT;

  // Timing-fingerprint path: metronomic + fast + near-perfect.
  const timingBot =
    correctRate >= HEURISTIC_CORRECT_RATE_MIN &&
    p50 < p50Ceiling &&
    relSpread <= HEURISTIC_MAX_SPREAD;

  // Score-backstop path: a near-perfect run whose score sits far past what
  // the game's players reach. Independent of timing spread, so it catches a
  // wallet that keeps its answers accurate and fast but adds just enough
  // jitter to stay under the spread gate. Only meaningful with a game scope.
  let scoreBot = false;
  if (scope?.game && correctRate >= HEURISTIC_CORRECT_RATE_MIN) {
    const { data: best } = await supabase
      .from("runs")
      .select("score")
      .eq("player", addr)
      .eq("game", scope.game)
      .gte("day_utc", since.slice(0, 10))
      .order("score", { ascending: false })
      .limit(1)
      .maybeSingle();
    const bestScore = (best as { score: number } | null)?.score ?? 0;
    scoreBot = bestScore >= HEURISTIC_SCORE_MAX[scope.game];
  }

  if (timingBot || scoreBot) {
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
        // No dedicated column for spread; stash it in notes for audit trail.
        notes: `spread=${relSpread.toFixed(2)} (p10=${p10}ms p90=${p90}ms)`,
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
      relSpread,
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
