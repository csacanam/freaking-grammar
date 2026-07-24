// POST a player's answer to the latest served Math equation. Body
// shape: { choice: "correct" | "incorrect" }. The client tells us
// whether the user thinks the displayed result is correct or not, and
// the server validates against the `math_truth` flag stored when the
// equation was generated. Truth lives server-side so a tampered client
// can't fake answers.
//
// One wrong answer ends the run (same as Grammar). On a correct
// answer, score increments and the next equation is generated and
// stored — the client only ever sees the next equation, never the
// truth value.

import type { NextRequest } from "next/server";
import { supabase, computeRank } from "@/lib/supabase";
import { generateMathQuestion, timeBudgetMs } from "@/lib/math-questions";

export const dynamic = "force-dynamic";

// Floor on how fast a real human can respond after a question is
// served. Below this we assume the caller is a bot hitting the API
// directly (the 2026-05-09 audit hit 175ms p50; humans on mobile with
// instant taps usually clock 700ms+). Reject with the same shape as a
// wrong answer so a bot can't reverse-engineer the threshold by
// pacing itself.
const MIN_ANSWER_MS = 400;

// Timeout enforcement.
//
// The player's visible bar and the server's served_at→now clock start at
// DIFFERENT instants: served_at is stamped when the server GENERATES the
// next equation (inside the previous answer's POST), but the client can't
// start its bar until that response crosses the network AND a short
// feedback pause elapses. So served_at→now runs ahead of the player's bar
// by (returnLatency + pause + submitLatency). Enforcing against served_at
// therefore times out correct answers while the bar still shows time — a
// diagnostic on 3 weeks of runs found ~959 correct answers wrongly killed.
//
// Fix: enforce against the CLIENT-reported elapsed (time the question was
// actually on screen), which is exactly what the player saw. served_at is
// kept only as an anti-abuse ceiling. Guards against a lying client:
//   - clientElapsed is clamped to [0, serverElapsed] — the bar can never
//     have run longer than the server's own clock, so a client can't
//     claim MORE time than physically elapsed.
//   - regardless of what the client claims, sitting > budget + IDLE_CEILING
//     past served_at ends the run (catches a client that under-reports to
//     camp on a question).
// Small jitter tolerance covers the 100ms client tick granularity.
const CLIENT_TIMER_TOL_MS = 250;
// Fallback tolerance when the client didn't report its elapsed (old cached
// build): generous enough to absorb pause + two mobile network legs so
// those clients don't hit the original bug either.
const NO_CLIENT_FALLBACK_TOL_MS = 1500;
// Absolute ceiling past the budget, enforced on served_at→now no matter
// what the client claims. Ends genuinely idle/paused sessions.
const IDLE_CEILING_MS = 5000;

// Silent live bot-flag ceiling for a single unbroken math run. Like Grammar,
// a math run is a pure streak (it ends on the first wrong answer), so a live
// run is 100% correct so far and the running score alone is the signal. Unlike
// Grammar, math has NO finite bank — equations are generated unboundedly — so
// there is no deterministic full-bank auto-flag to lean on; this ceiling is the
// only live defense beyond the timing floor. The gray zone between the top real
// human (~40-50) and blatant bots (180+) is genuinely ambiguous and left to the
// settlement heuristic + manual watch; this ceiling is set to pull egregious
// live scores off the podium, not to adjudicate the gray zone. We do NOT end
// the run and the response is unchanged, so the operator can't detect or pace
// under the line. Operative value lives in the private deploy env; the public
// default is effectively off.
const LIVE_FLAG_SCORE_MATH = Number(
  process.env.BOT_LIVE_SCORE_MAX_MATH ?? 100_000,
);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!supabase) {
    return Response.json({ error: "db-unconfigured" }, { status: 503 });
  }

  const { id: runId } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    choice?: string;
    clientElapsedMs?: number;
  };
  const choice = body.choice;
  if (choice !== "correct" && choice !== "incorrect") {
    return Response.json({ error: "invalid-body" }, { status: 400 });
  }
  const clientElapsedMs =
    typeof body.clientElapsedMs === "number" &&
    Number.isFinite(body.clientElapsedMs) &&
    body.clientElapsedMs >= 0
      ? body.clientElapsedMs
      : null;

  const { data: runRow } = await supabase
    .from("runs")
    .select("id,player,score,status,day_utc,game")
    .eq("id", runId)
    .maybeSingle();

  if (!runRow) {
    return Response.json({ error: "not-found" }, { status: 404 });
  }
  const run = runRow as {
    id: string;
    player: string;
    score: number;
    status: string;
    day_utc: string;
    game: string;
  };
  if (run.game !== "math") {
    return Response.json({ error: "not-a-math-run" }, { status: 400 });
  }
  if (run.status !== "open") {
    return Response.json({ error: "run-closed" }, { status: 409 });
  }

  // Latest served equation for this run.
  const { data: rqRow } = await supabase
    .from("run_questions")
    .select("id,q_index,served_at,answered_at,math_truth")
    .eq("run_id", runId)
    .order("q_index", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!rqRow) {
    return Response.json({ error: "no-question" }, { status: 409 });
  }
  const rq = rqRow as {
    id: string;
    q_index: number;
    served_at: string;
    answered_at: string | null;
    math_truth: boolean | null;
  };
  if (rq.answered_at) {
    return Response.json({ error: "already-answered" }, { status: 409 });
  }
  if (rq.math_truth === null) {
    return Response.json({ error: "missing-truth" }, { status: 500 });
  }

  // Server-side timer enforcement. The UI shows a per-question clock
  // (2.5s → 1.5s as q_index climbs) but UI timers are decoration —
  // anyone hitting this endpoint directly bypasses them. The
  // 2026-05-09 audit confirmed a bot reached score 55 by answering
  // every question in ~175ms with no rejection. Now the server reads
  // its own served_at vs now and shuts down two failure modes:
  //
  //   1. answered too fast (< MIN_ANSWER_MS) → almost certainly a
  //      direct-API bot; close the run silently as "wrong" so they
  //      can't binary-search the threshold by pacing themselves
  //   2. answered too slow (> budget + tolerance) → human ran out
  //      of time on the UI clock; close as "timeout" with the score
  //      they had before this attempt
  //
  // q_index 0 is the warm-up — no upper bound (the briefing tells
  // players "take your time on the first one"), but the lower bound
  // still applies so a bot can't drop in instant answers.
  // Server's own clock — authoritative for the LOWER bound (a direct-API
  // bot that never renders a bar can't prove it was slower than this) and
  // for the anti-abuse ceiling.
  const serverElapsedMs = Date.now() - new Date(rq.served_at).getTime();
  const tooFast = serverElapsedMs < MIN_ANSWER_MS;

  // UPPER bound (timeout) is judged against what the player actually saw.
  // Clamp the client's claim to the server clock so it can't be inflated.
  const budgetMs = timeBudgetMs(rq.q_index);
  const effectiveElapsedMs =
    clientElapsedMs !== null
      ? Math.min(clientElapsedMs, serverElapsedMs)
      : serverElapsedMs;
  const upperTolMs =
    clientElapsedMs !== null ? CLIENT_TIMER_TOL_MS : NO_CLIENT_FALLBACK_TOL_MS;
  const tooSlow =
    rq.q_index > 0 &&
    (effectiveElapsedMs > budgetMs + upperTolMs ||
      serverElapsedMs > budgetMs + IDLE_CEILING_MS);

  if (tooFast || tooSlow) {
    const reason: "wrong" | "timeout" = tooSlow ? "timeout" : "wrong";
    await supabase
      .from("run_questions")
      .update({
        answered_at: new Date().toISOString(),
        answer_correct: false,
        answer_choice: choice,
      })
      .eq("id", rq.id);
    await supabase
      .from("runs")
      .update({ status: "finished", ended_at: new Date().toISOString() })
      .eq("id", runId);
    const rank = await computeRank(
      { game: "math" },
      run.day_utc,
      run.player,
      run.score,
    );
    return Response.json({
      correct: false,
      ended: true,
      reason,
      score: run.score,
      rank,
    });
  }

  // Player's choice "correct" means they think the shown result is the
  // real answer. Compare against `math_truth`.
  const playerSaidCorrect = choice === "correct";
  const isRight = playerSaidCorrect === rq.math_truth;

  await supabase
    .from("run_questions")
    .update({
      answered_at: new Date().toISOString(),
      answer_correct: isRight,
      answer_choice: choice,
    })
    .eq("id", rq.id);

  if (!isRight) {
    await supabase
      .from("runs")
      .update({ status: "finished", ended_at: new Date().toISOString() })
      .eq("id", runId);

    const rank = await computeRank(
      { game: "math" },
      run.day_utc,
      run.player,
      run.score,
    );
    return Response.json({
      correct: false,
      ended: true,
      reason: "wrong",
      score: run.score,
      rank,
    });
  }

  const newScore = run.score + 1;
  await supabase.from("runs").update({ score: newScore }).eq("id", runId);

  // Silent live bot-flag — see LIVE_FLAG_SCORE_MATH. Response unchanged (the
  // caller can't tell it was flagged); ignoreDuplicates keeps an already-flagged
  // wallet's original context; errors are non-fatal so a failed flag never
  // blocks the answer; `>=` so a transient write failure at the crossing
  // retries on the next answer.
  if (newScore >= LIVE_FLAG_SCORE_MATH) {
    const { error: liveFlagErr } = await supabase.from("bot_wallets").upsert(
      {
        player: run.player,
        reason: "heuristic",
        sample_size: newScore,
        notes: `auto: live MATH streak past ceiling (${newScore})`,
      },
      { onConflict: "player", ignoreDuplicates: true },
    );
    if (liveFlagErr) {
      console.error("live bot-flag failed (non-fatal):", liveFlagErr);
    }
  }

  // Generate the next equation. Math has unbounded difficulty (the
  // generator floors at 1.5s + off-by-1 wrongs around q=30), so unlike
  // Grammar there's no "exhausted the bank" path.
  const nextQ = generateMathQuestion(rq.q_index + 1);
  await supabase.from("run_questions").insert({
    run_id: runId,
    q_index: rq.q_index + 1,
    math_left: nextQ.left,
    math_right: nextQ.right,
    math_op: nextQ.op,
    math_shown: nextQ.shown,
    math_truth: nextQ.truth,
  });

  return Response.json({
    correct: true,
    score: newScore,
    nextQuestion: {
      left: nextQ.left,
      right: nextQ.right,
      op: nextQ.op,
      shown: nextQ.shown,
    },
  });
}
