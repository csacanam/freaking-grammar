import type { NextRequest } from "next/server";
import { supabase, computeRank } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type QuestionRow = { id: string; phrase: string; correct: string; wrong: string };

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!supabase) {
    return Response.json({ error: "db-unconfigured" }, { status: 503 });
  }

  const { id: runId } = await params;
  const body = (await req.json().catch(() => ({}))) as { pickedWord?: string };
  const pickedWord = body.pickedWord;
  if (!pickedWord) {
    return Response.json({ error: "invalid-body" }, { status: 400 });
  }

  const { data: runRow } = await supabase
    .from("runs")
    .select("id,player,score,status,day_utc,lang")
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
    lang: string;
  };
  if (run.status !== "open") {
    return Response.json({ error: "run-closed" }, { status: 409 });
  }

  // Latest served question for this run.
  const { data: rqRow } = await supabase
    .from("run_questions")
    .select("id,question_id,q_index,answered_at")
    .eq("run_id", runId)
    .order("q_index", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!rqRow) {
    return Response.json({ error: "no-question" }, { status: 409 });
  }
  const rq = rqRow as {
    id: string;
    question_id: string;
    q_index: number;
    answered_at: string | null;
  };
  if (rq.answered_at) {
    return Response.json({ error: "already-answered" }, { status: 409 });
  }

  const { data: qRow } = await supabase
    .from("questions")
    .select("correct")
    .eq("id", rq.question_id)
    .single();

  if (!qRow) {
    return Response.json({ error: "question-missing" }, { status: 500 });
  }
  const q = qRow as { correct: string };

  const isCorrect = pickedWord === q.correct;

  await supabase
    .from("run_questions")
    .update({
      answered_at: new Date().toISOString(),
      answer_correct: isCorrect,
    })
    .eq("id", rq.id);

  if (!isCorrect) {
    await supabase
      .from("runs")
      .update({ status: "finished", ended_at: new Date().toISOString() })
      .eq("id", runId);

    const rank = await computeRank(run.lang, run.day_utc, run.player, run.score);
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

  // Pick next question not already served in this run.
  const [{ data: allQ }, { data: seenQ }] = await Promise.all([
    supabase
      .from("questions")
      .select("id,phrase,correct,wrong")
      .eq("lang", run.lang)
      .eq("active", true),
    supabase.from("run_questions").select("question_id").eq("run_id", runId),
  ]);

  const seenIds = new Set(
    ((seenQ ?? []) as Array<{ question_id: string }>).map((x) => x.question_id),
  );
  const available = ((allQ ?? []) as QuestionRow[]).filter(
    (row) => !seenIds.has(row.id),
  );

  if (available.length === 0) {
    await supabase
      .from("runs")
      .update({ status: "finished", ended_at: new Date().toISOString() })
      .eq("id", runId);

    const rank = await computeRank(run.lang, run.day_utc, run.player, newScore);
    return Response.json({
      correct: true,
      ended: true,
      reason: "cleared",
      score: newScore,
      rank,
    });
  }

  const next = available[Math.floor(Math.random() * available.length)];
  await supabase.from("run_questions").insert({
    run_id: runId,
    question_id: next.id,
    q_index: rq.q_index + 1,
  });

  return Response.json({
    correct: true,
    score: newScore,
    nextQuestion: {
      phrase: next.phrase,
      correct: next.correct,
      wrong: next.wrong,
    },
  });
}
