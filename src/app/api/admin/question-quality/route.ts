// Per-question failure breakdown. Two uses:
//   1. Content quality — which phrases confuse players the most? Those are
//      candidates for rewrite or removal.
//   2. Bot-vs-cheater signal at the aggregate — if a single question has
//      dramatically faster mean response time than the rest, someone may
//      have a lookup running.
//
// "Failure" splits into two distinct signals — high failure rate alone
// doesn't mean a question is bad, it might just be hard. Read together:
//   - timeoutPct high          → ambiguous/confusing (people stare, can't
//                                decide between two plausible options)
//   - wrongOfAnsweredPct ~50%  → ambiguous (random guessing among committers)
//   - wrongOfAnsweredPct >50%  → suspect — distractor more attractive than
//                                the "correct" answer; check the answer key
//   - wrongOfAnsweredPct 30-50% with low timeoutPct → just legitimately hard
//
// Classification:
//   - correct  : answer_correct = true
//   - wrong    : answer_correct = false (user picked the decoy)
//   - timeout  : answered_at IS NULL on a closed run (timer ran out, or
//                user walked away — finish endpoint marks the run finished
//                or abandoned but doesn't touch the dangling row)
//
// Only counts run_questions from non-open runs so in-progress sessions
// don't skew the stats.
//
// Internal ops endpoint, gated by CRON_SECRET. Not surfaced in /stats —
// publishing per-question failure rates would tip off players who are
// already memorising the bank.

import type { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type Row = {
  question_id: string;
  served_at: string;
  answered_at: string | null;
  answer_correct: boolean | null;
  questions: {
    id: string;
    lang: string;
    phrase: string;
    correct: string;
    wrong: string;
    active: boolean;
  } | null;
  runs: { status: string } | null;
};

type Bucket = {
  id: string;
  lang: string;
  phrase: string;
  correct: string;
  wrong: string;
  active: boolean;
  served: number;
  correctCount: number;
  wrongCount: number;
  timeoutCount: number;
  responseMsSamples: number[];
};

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
  const lang = sp.get("lang"); // optional: 'en' | 'es'
  const days = Math.max(1, Math.min(180, Number(sp.get("days") ?? 30)));
  const minSamples = Math.max(1, Number(sp.get("min_samples") ?? 5));

  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  let query = supabase
    .from("run_questions")
    .select(
      "question_id,served_at,answered_at,answer_correct,questions!inner(id,lang,phrase,correct,wrong,active),runs!inner(status)",
    )
    .gte("served_at", since)
    .neq("runs.status", "open");

  if (lang === "en" || lang === "es") {
    query = query.eq("questions.lang", lang);
  }

  // Supabase caps single-page reads at 1000 rows; paginate.
  const PAGE = 1000;
  const buckets = new Map<string, Bucket>();
  let totalRows = 0;
  let offset = 0;
  for (;;) {
    const { data, error } = await query.range(offset, offset + PAGE - 1);
    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }
    const page = (data ?? []) as unknown as Row[];
    if (page.length === 0) break;
    totalRows += page.length;

    for (const r of page) {
      if (!r.questions) continue;
      const key = r.question_id;
      let b = buckets.get(key);
      if (!b) {
        b = {
          id: r.questions.id,
          lang: r.questions.lang,
          phrase: r.questions.phrase,
          correct: r.questions.correct,
          wrong: r.questions.wrong,
          active: r.questions.active,
          served: 0,
          correctCount: 0,
          wrongCount: 0,
          timeoutCount: 0,
          responseMsSamples: [],
        };
        buckets.set(key, b);
      }
      b.served++;
      if (r.answered_at === null) {
        b.timeoutCount++;
        continue;
      }
      const ms = new Date(r.answered_at).getTime() - new Date(r.served_at).getTime();
      if (ms >= 0 && ms <= 10_000) b.responseMsSamples.push(ms);
      if (r.answer_correct === true) b.correctCount++;
      else if (r.answer_correct === false) b.wrongCount++;
    }

    if (page.length < PAGE) break;
    offset += PAGE;
  }

  const out = [...buckets.values()]
    .filter((b) => b.served >= minSamples)
    .map((b) => {
      const samples = b.responseMsSamples.sort((a, c) => a - c);
      const avg =
        samples.length > 0
          ? Math.round(samples.reduce((s, n) => s + n, 0) / samples.length)
          : null;
      const p50 = samples.length > 0 ? samples[Math.floor(samples.length * 0.5)] : null;
      const p90 = samples.length > 0 ? samples[Math.floor(samples.length * 0.9)] : null;
      const correctPct = b.served > 0 ? b.correctCount / b.served : 0;
      const wrongPct = b.served > 0 ? b.wrongCount / b.served : 0;
      const timeoutPct = b.served > 0 ? b.timeoutCount / b.served : 0;
      const answered = b.correctCount + b.wrongCount;
      // Pure-difficulty signal among players who actually committed to a
      // choice. Closer to 0.5 → ambiguous; >0.5 → answer key may be off.
      const wrongOfAnsweredPct = answered > 0 ? b.wrongCount / answered : 0;
      const failurePct = wrongPct + timeoutPct;
      return {
        id: b.id,
        lang: b.lang,
        phrase: b.phrase,
        correct: b.correct,
        wrong: b.wrong,
        active: b.active,
        served: b.served,
        correctCount: b.correctCount,
        wrongCount: b.wrongCount,
        timeoutCount: b.timeoutCount,
        correctPct: round2(correctPct),
        wrongPct: round2(wrongPct),
        timeoutPct: round2(timeoutPct),
        wrongOfAnsweredPct: round2(wrongOfAnsweredPct),
        failurePct: round2(failurePct),
        avgResponseMs: avg,
        p50ResponseMs: p50,
        p90ResponseMs: p90,
      };
    })
    .sort((a, b) => b.failurePct - a.failurePct);

  return Response.json({
    sinceIso: since,
    days,
    minSamples,
    lang: lang ?? "all",
    totalRows,
    questionCount: out.length,
    questions: out,
  });
}

function round2(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
