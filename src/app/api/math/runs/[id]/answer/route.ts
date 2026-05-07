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
import { generateMathQuestion } from "@/lib/math-questions";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!supabase) {
    return Response.json({ error: "db-unconfigured" }, { status: 503 });
  }

  const { id: runId } = await params;
  const body = (await req.json().catch(() => ({}))) as { choice?: string };
  const choice = body.choice;
  if (choice !== "correct" && choice !== "incorrect") {
    return Response.json({ error: "invalid-body" }, { status: 400 });
  }

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
    .select("id,q_index,answered_at,math_truth")
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
    answered_at: string | null;
    math_truth: boolean | null;
  };
  if (rq.answered_at) {
    return Response.json({ error: "already-answered" }, { status: 409 });
  }
  if (rq.math_truth === null) {
    return Response.json({ error: "missing-truth" }, { status: 500 });
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
