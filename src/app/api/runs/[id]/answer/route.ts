import type { NextRequest } from "next/server";
import { supabase, computeRank } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type QuestionRow = { id: string; phrase: string; correct: string; wrong: string };

// Floor on how fast a real human can answer after a question is served.
// Below this the caller is almost certainly a bot hitting the API directly —
// no human reads a phrase + two words and taps in under 400ms. Matches the
// Math route's floor. Rejected with the same shape as a wrong answer so a bot
// can't reverse-engineer the threshold by pacing itself.
const MIN_ANSWER_MS = 400;

// The client gives 5s per question (QUESTION_SECONDS). This is the server-side
// ceiling for the same window, kept deliberately lenient: served_at starts
// when we INSERT the next question, but the client's 5s clock only starts once
// it receives + renders it (network + transition), so server-elapsed runs
// ahead of the player's clock. A generous overrun avoids falsely timing out
// real players; the real anti-bot lever here is the floor + hidden answer.
const GRAMMAR_QUESTION_MS = 5000;
const ANSWER_OVERRUN_MS = 3000;

// Serve the two words shuffled and WITHOUT saying which is correct — see the
// note in ../../route.ts. Keeps the answer server-side so a direct-API bot
// can't just echo back the correct word.
function shuffledOptions(correct: string, wrong: string): [string, string] {
  return Math.random() < 0.5 ? [correct, wrong] : [wrong, correct];
}

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
    .select("id,question_id,q_index,served_at,answered_at")
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
    served_at: string;
    answered_at: string | null;
  };
  if (rq.answered_at) {
    return Response.json({ error: "already-answered" }, { status: 409 });
  }

  // Server-side timer enforcement. The 5s per-question clock the UI shows is
  // pure decoration — anyone POSTing here directly bypasses it. Read our own
  // served_at vs now and shut down two failure modes, mirroring the Math route:
  //   1. too fast (< MIN_ANSWER_MS) → direct-API bot; close silently as "wrong"
  //      so it can't binary-search the threshold by pacing itself.
  //   2. too slow (> budget + overrun) → ran out of time; close as "timeout".
  // q_index 0 is the untimed warm-up (the briefing says "take your time"), so
  // no upper bound there — but the floor still applies so a bot can't drop in
  // instant answers on the first question either.
  const elapsedMs = Date.now() - new Date(rq.served_at).getTime();
  const tooFast = elapsedMs < MIN_ANSWER_MS;
  const tooSlow =
    rq.q_index > 0 && elapsedMs > GRAMMAR_QUESTION_MS + ANSWER_OVERRUN_MS;
  if (tooFast || tooSlow) {
    const reason: "wrong" | "timeout" = tooSlow ? "timeout" : "wrong";
    await supabase
      .from("run_questions")
      .update({ answered_at: new Date().toISOString(), answer_correct: false })
      .eq("id", rq.id);
    await supabase
      .from("runs")
      .update({ status: "finished", ended_at: new Date().toISOString() })
      .eq("id", runId);
    const rank = await computeRank(
      { game: "grammar", lang: run.lang as "en" | "es" },
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

    const rank = await computeRank(
      { game: "grammar", lang: run.lang as "en" | "es" },
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

    // Clearing the ENTIRE active question bank — every question answered
    // correctly, each within the server timer — is deterministically beyond
    // human ability (the bank is 200+ questions; the top real player clears
    // ~70). It only happens with a harvested answer key. Auto-flag the wallet
    // into the blocklist so it drops off the live podium (lobby filters
    // bot_wallets) and is skipped at settlement. reason='heuristic' (automated);
    // ignoreDuplicates so an already-flagged wallet keeps its original context;
    // non-fatal so the player's result still returns.
    const { error: flagErr } = await supabase.from("bot_wallets").upsert(
      {
        player: run.player,
        reason: "heuristic",
        sample_size: newScore,
        notes: `auto: cleared full ${run.lang.toUpperCase()} bank (${newScore})`,
      },
      { onConflict: "player", ignoreDuplicates: true },
    );
    if (flagErr) {
      console.error("bank-clear auto-flag failed (non-fatal):", flagErr);
    }

    const rank = await computeRank(
      { game: "grammar", lang: run.lang as "en" | "es" },
      run.day_utc,
      run.player,
      newScore,
    );
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
      options: shuffledOptions(next.correct, next.wrong),
    },
  });
}
