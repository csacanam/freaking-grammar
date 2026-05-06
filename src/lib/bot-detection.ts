// Two-layer bot filter used by `roll-day` when picking the daily winner.
// Layer 1: a hardcoded blocklist of wallets we already confirmed are bots
// (one operator running ≥6 sybil wallets, all sharing the same impossibly
// uniform ~1.5–2.0s response timing and 100% correctness across hundreds
// of answers). Layer 2: a stats heuristic that fires on any new wallet
// matching the same signature.
//
// Heuristic threshold: correctRate ≥ 99% AND p50 < 2400ms.
// Calibrated against ~12 confirmed humans (correctRate 67–86%, p50
// 2637–3833ms) and 6 confirmed bots (correctRate 99.7–100%, p50
// 1510–2095ms). The gap between bot p50 max (2095ms) and human p50 min
// (2637ms) is 542ms — wide enough that minimum-sample noise won't push
// a real human across.
//
// Min sample of 30 timed answers (q_index > 0, answered_at not null,
// from non-open runs) keeps the heuristic from misfiring on a single
// lucky session.

import type { SupabaseClient } from "@supabase/supabase-js";

const BLACKLIST = new Set<string>([
  "0x247116c752420ec7fe870d1549a1c2e8d44675c6", // master, funded the rest
  "0x1d7d4da72a32b0ab37b92c773c15412381c7203a", // 4-day winner
  "0x351d9ac846d3a4e71c2103b91ed7aca67d85be5e",
  "0xf6826a75a9a9fb41f14732e5ca03df402d2e52ea",
  "0xdead181ffb8e104ec9347dbf2b8f5884e1ba5f3b", // vanity address
  "0xa41836014a58f004ee0746c7c66305fdcc252cbd",
]);

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

export async function checkBotPlayer(
  player: string,
  supabase: SupabaseClient,
): Promise<BotFlag> {
  const addr = player.toLowerCase();

  if (BLACKLIST.has(addr)) {
    return { flagged: true, reason: "blacklist" };
  }

  const since = new Date(
    Date.now() - HEURISTIC_LOOKBACK_DAYS * 86_400_000,
  ).toISOString();

  const { data } = await supabase
    .from("run_questions")
    .select(
      "q_index,served_at,answered_at,answer_correct,runs!inner(player,status)",
    )
    .eq("runs.player", addr)
    .gte("served_at", since)
    .gt("q_index", 0) // q_index 0 has no timer; not useful for fingerprinting
    .neq("runs.status", "open")
    .limit(2000);

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
