import type { NextRequest } from "next/server";
import { supabase, computeRank } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!supabase) {
    return Response.json({ error: "db-unconfigured" }, { status: 503 });
  }

  const { id: runId } = await params;
  const body = (await req.json().catch(() => ({}))) as { reason?: string };
  const reason = body.reason === "abandoned" ? "abandoned" : "timeout";

  const { data: runRow } = await supabase
    .from("runs")
    .select("player,score,status,day_utc,lang")
    .eq("id", runId)
    .maybeSingle();

  if (!runRow) {
    return Response.json({ error: "not-found" }, { status: 404 });
  }
  const run = runRow as {
    player: string;
    score: number;
    status: string;
    day_utc: string;
    lang: string;
  };

  if (run.status === "open") {
    await supabase
      .from("runs")
      .update({
        status: reason === "abandoned" ? "abandoned" : "finished",
        ended_at: new Date().toISOString(),
      })
      .eq("id", runId);
  }

  // Reveal the question the clock ran out on, so the game-over screen can show
  // what the answer was — same rationale as the answer route. Only the latest
  // question counts, and only if it was never answered (a run finished right
  // after a correct answer has nothing pending to reveal). Best-effort: any
  // failure here just means no reveal, never a failed finish.
  let reveal: { phrase: string; correctWord: string } | null = null;
  if (reason === "timeout") {
    const { data: rqRow } = await supabase
      .from("run_questions")
      .select("answered_at,questions!inner(phrase,correct)")
      .eq("run_id", runId)
      .order("q_index", { ascending: false })
      .limit(1)
      .maybeSingle();
    const rq = rqRow as {
      answered_at: string | null;
      questions: { phrase: string; correct: string };
    } | null;
    if (rq && !rq.answered_at && rq.questions) {
      reveal = { phrase: rq.questions.phrase, correctWord: rq.questions.correct };
    }
  }

  const rank = await computeRank(
    { game: "grammar", lang: run.lang as "en" | "es" },
    run.day_utc,
    run.player,
    run.score,
  );
  return Response.json({ score: run.score, rank, ...reveal });
}
