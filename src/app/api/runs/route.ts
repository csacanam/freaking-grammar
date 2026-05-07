import type { NextRequest } from "next/server";
import { isAddressEqual, zeroAddress } from "viem";
import { gameIdFor, validateLang } from "@/lib/i18n";
import { supabase, todayUtc } from "@/lib/supabase";
import { POT_ADDRESS } from "@/lib/chain";
import { verifyPaymentTx } from "@/lib/onchain";
import { maybeAlertBotPlay } from "@/lib/bot-detection";
import { sendTelegramMessage } from "@/lib/telegram";

export const dynamic = "force-dynamic";

type QuestionRow = { id: string; phrase: string; correct: string; wrong: string };

export async function POST(req: NextRequest) {
  if (!supabase) {
    return Response.json({ error: "db-unconfigured" }, { status: 503 });
  }
  if (isAddressEqual(POT_ADDRESS, zeroAddress)) {
    return Response.json({ error: "contract-not-deployed" }, { status: 503 });
  }

  const lang = validateLang(req.nextUrl.searchParams.get("lang"));
  const gameId = gameIdFor(lang);

  const body = (await req.json().catch(() => ({}))) as {
    player?: string;
    txHash?: string;
  };
  const player = body.player?.toLowerCase();
  const txHash =
    body.txHash && /^0x[0-9a-f]{64}$/i.test(body.txHash)
      ? body.txHash.toLowerCase()
      : null;
  if (!player || !/^0x[0-9a-f]{40}$/.test(player)) {
    return Response.json({ error: "invalid-player" }, { status: 400 });
  }
  if (!txHash) {
    return Response.json({ error: "tx-required" }, { status: 400 });
  }

  const day = todayUtc();

  // Every play must be backed by a real on-chain play() call — prevents
  // fake / ghost addresses flooding the leaderboard. The contract is the
  // source of truth for was_free (first play of the day is free per the
  // `lastFreePlayDay` map).
  //
  // Idempotent: if a run already exists for this txHash and is still open
  // at q_index=0 (user hasn't answered anything yet), return the original
  // runId + question instead of erroring. This covers double-invoke from
  // client effects re-running, page reloads during the briefing/countdown,
  // or StrictMode-style double mounts. A progressed or finished run
  // (status != open, or any answered question) still rejects the replay.
  const { data: dup } = await supabase
    .from("runs")
    .select("id,status")
    .eq("paid_tx_hash", txHash)
    .maybeSingle();
  if (dup) {
    const dupId = (dup as { id: string; status: string }).id;
    const dupStatus = (dup as { id: string; status: string }).status;
    if (dupStatus !== "open") {
      return Response.json({ error: "tx-already-used" }, { status: 400 });
    }

    const { data: rqData } = await supabase
      .from("run_questions")
      .select("question_id,q_index,answered_at")
      .eq("run_id", dupId)
      .order("q_index", { ascending: true });
    const rqs = (rqData ?? []) as Array<{
      question_id: string;
      q_index: number;
      answered_at: string | null;
    }>;
    const anyAnswered = rqs.some((r) => r.answered_at !== null);
    if (anyAnswered) {
      return Response.json({ error: "tx-already-used" }, { status: 400 });
    }

    const firstQId = rqs[0]?.question_id;
    if (!firstQId) {
      return Response.json({ error: "tx-already-used" }, { status: 400 });
    }
    const { data: qRow } = await supabase
      .from("questions")
      .select("phrase,correct,wrong")
      .eq("id", firstQId)
      .maybeSingle();
    if (!qRow) {
      return Response.json({ error: "tx-already-used" }, { status: 400 });
    }
    const q = qRow as { phrase: string; correct: string; wrong: string };
    return Response.json({
      runId: dupId,
      question: { phrase: q.phrase, correct: q.correct, wrong: q.wrong },
    });
  }

  const check = await verifyPaymentTx(txHash, player, gameId);
  if (!check.valid) {
    return Response.json({ error: check.reason }, { status: 400 });
  }
  const potAmountAfter = check.potAfter;
  const wasFree = check.wasFree;

  // Heads-up to ops if a known-bot wallet is paying. Fire-and-forget —
  // must not block the play even if Telegram is down.
  void maybeAlertBotPlay({
    player,
    gameLabel: `Grammar ${lang.toUpperCase()}`,
    wasFree,
    day,
    supabase,
    sendTelegram: sendTelegramMessage,
  });

  const { data: runRow, error: runErr } = await supabase
    .from("runs")
    .insert({
      lang,
      game_id: gameId,
      day_utc: day,
      player,
      was_free: wasFree,
      paid_tx_hash: txHash,
      status: "open",
    })
    .select("id")
    .single();

  if (runErr || !runRow) {
    return Response.json({ error: "failed-to-create-run" }, { status: 500 });
  }
  const runId = (runRow as { id: string }).id;

  await supabase
    .from("pots")
    .update({ amount_units: potAmountAfter.toString() })
    .eq("lang", lang)
    .eq("day_utc", day);

  const { data: qData } = await supabase
    .from("questions")
    .select("id,phrase,correct,wrong")
    .eq("lang", lang)
    .eq("active", true);

  const questions = (qData ?? []) as QuestionRow[];
  if (questions.length === 0) {
    return Response.json({ error: "no-questions" }, { status: 500 });
  }

  const pick = questions[Math.floor(Math.random() * questions.length)];

  await supabase.from("run_questions").insert({
    run_id: runId,
    question_id: pick.id,
    q_index: 0,
  });

  return Response.json({
    runId,
    question: {
      phrase: pick.phrase,
      correct: pick.correct,
      wrong: pick.wrong,
    },
  });
}
