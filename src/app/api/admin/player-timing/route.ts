// Per-player timing histogram. The bot-detection counterpart to
// question-quality. For a given wallet, returns:
//   - Per-answer log: response time + correctness, run by run
//   - Distribution: percentiles + bucketed histogram
//
// Honest humans look spread across 1.5–4.5s with a wide tail. Bots cluster
// tight and fast (<500ms, suspiciously consistent). "Pause and look up"
// cheaters cluster at the 4–5s edge with high accuracy. The shape of the
// histogram is what flags them, not any single number.
//
// Note: q_index = 0 has no timer (every-play tutorial question), so its
// response time is meaningless for cheat detection. We exclude it from
// the distribution but still include it in the per-answer log so you can
// see the full session.
//
// Internal ops endpoint, gated by CRON_SECRET.

import type { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type Row = {
  q_index: number;
  served_at: string;
  answered_at: string | null;
  answer_correct: boolean | null;
  question_id: string;
  runs: {
    id: string;
    lang: string;
    day_utc: string;
    score: number;
    status: string;
    was_free: boolean;
  } | null;
};

const BUCKETS: Array<{ label: string; max: number }> = [
  { label: "0-500ms", max: 500 },
  { label: "500-1000ms", max: 1000 },
  { label: "1000-2000ms", max: 2000 },
  { label: "2000-3000ms", max: 3000 },
  { label: "3000-4000ms", max: 4000 },
  { label: "4000-5000ms", max: 5000 },
  { label: ">5000ms", max: Infinity },
];

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
  }
  if (!supabase) {
    return Response.json({ error: "db-unconfigured" }, { status: 503 });
  }

  const sp = req.nextUrl.searchParams;
  const player = sp.get("player")?.toLowerCase();
  if (!player || !/^0x[0-9a-f]{40}$/.test(player)) {
    return Response.json({ error: "bad-player" }, { status: 400 });
  }
  const days = Math.max(1, Math.min(180, Number(sp.get("days") ?? 30)));
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  const { data, error } = await supabase
    .from("run_questions")
    .select(
      "q_index,served_at,answered_at,answer_correct,question_id,runs!inner(id,lang,day_utc,score,status,was_free,player)",
    )
    .eq("runs.player", player)
    .gte("served_at", since)
    .order("served_at", { ascending: true })
    .limit(5000);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as unknown as Row[];

  type RunBucket = {
    id: string;
    lang: string;
    day: string;
    score: number;
    status: string;
    wasFree: boolean;
    // How the run died. Derived after we've collected all answers:
    //   wrong-answer  → committed to the decoy on the last served question
    //   timeout       → last served question expired (no answer)
    //   exhausted     → answered every question in the bank correctly
    //   in-progress   → run still open
    endedReason?: "wrong-answer" | "timeout" | "exhausted" | "in-progress";
    answers: Array<{
      qIndex: number;
      questionId: string;
      ms: number | null;
      correct: boolean | null;
    }>;
  };
  const runs = new Map<string, RunBucket>();
  const timedSamples: number[] = []; // q_index > 0, with answered_at
  let totalAnswered = 0;
  let totalCorrect = 0;
  let totalWrong = 0;
  let totalTimeout = 0;
  let suspiciouslyFast = 0; // < 500ms

  for (const r of rows) {
    if (!r.runs) continue;
    const ms =
      r.answered_at !== null
        ? new Date(r.answered_at).getTime() - new Date(r.served_at).getTime()
        : null;

    let bucket = runs.get(r.runs.id);
    if (!bucket) {
      bucket = {
        id: r.runs.id,
        lang: r.runs.lang,
        day: r.runs.day_utc,
        score: r.runs.score,
        status: r.runs.status,
        wasFree: r.runs.was_free,
        answers: [],
      };
      runs.set(r.runs.id, bucket);
    }
    bucket.answers.push({
      qIndex: r.q_index,
      questionId: r.question_id,
      ms,
      correct: r.answer_correct,
    });

    if (r.answered_at === null) {
      if (r.runs.status !== "open") totalTimeout++;
      continue;
    }
    totalAnswered++;
    if (r.answer_correct === true) totalCorrect++;
    else if (r.answer_correct === false) totalWrong++;

    // Distribution excludes q_index = 0 (no timer that question).
    if (r.q_index > 0 && ms !== null && ms >= 0 && ms <= 10_000) {
      timedSamples.push(ms);
      if (ms < 500) suspiciouslyFast++;
    }
  }

  timedSamples.sort((a, b) => a - b);
  const pct = (p: number): number | null => {
    if (timedSamples.length === 0) return null;
    return timedSamples[Math.floor(timedSamples.length * p)] ?? null;
  };
  const mean =
    timedSamples.length > 0
      ? Math.round(timedSamples.reduce((s, n) => s + n, 0) / timedSamples.length)
      : null;

  const histogram = BUCKETS.map((b, i) => {
    const lower = i === 0 ? 0 : BUCKETS[i - 1].max;
    const count = timedSamples.filter((s) => s >= lower && s < b.max).length;
    return {
      label: b.label,
      count,
      pct: timedSamples.length > 0 ? round4(count / timedSamples.length) : 0,
    };
  });

  // Per-question: how many times each question_id was served to this
  // player (memorisation signal — same question seen many times = pool
  // recycled for them).
  const perQuestion = new Map<string, number>();
  for (const r of rows) {
    perQuestion.set(r.question_id, (perQuestion.get(r.question_id) ?? 0) + 1);
  }
  const repeats = [...perQuestion.entries()]
    .filter(([, n]) => n > 1)
    .map(([id, n]) => ({ questionId: id, timesSeen: n }))
    .sort((a, b) => b.timesSeen - a.timesSeen);

  return Response.json({
    player,
    days,
    sinceIso: since,
    runCount: runs.size,
    totals: {
      answered: totalAnswered,
      correct: totalCorrect,
      wrong: totalWrong,
      timeout: totalTimeout,
      correctRate: totalAnswered > 0 ? round4(totalCorrect / totalAnswered) : 0,
    },
    timing: {
      timedAnswers: timedSamples.length,
      suspiciouslyFast, // < 500ms
      meanMs: mean,
      minMs: timedSamples[0] ?? null,
      maxMs: timedSamples[timedSamples.length - 1] ?? null,
      p10: pct(0.1),
      p25: pct(0.25),
      p50: pct(0.5),
      p75: pct(0.75),
      p90: pct(0.9),
      p95: pct(0.95),
    },
    histogram,
    repeatedQuestions: repeats,
    runs: [...runs.values()]
      .map((r) => {
        r.answers.sort((a, b) => a.qIndex - b.qIndex);
        const last = r.answers[r.answers.length - 1];
        let endedReason: RunBucket["endedReason"];
        if (r.status === "open") endedReason = "in-progress";
        else if (!last) endedReason = "timeout";
        else if (last.correct === false) endedReason = "wrong-answer";
        else if (last.correct === null) endedReason = "timeout";
        else endedReason = "exhausted"; // every served Q was correct
        return { ...r, endedReason };
      })
      .sort((a, b) => a.day.localeCompare(b.day)),
  });
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
