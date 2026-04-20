import type { NextRequest } from "next/server";
import { isAddressEqual, zeroAddress } from "viem";
import { gameIdFor, validateLang } from "@/lib/i18n";
import { supabase, todayUtc } from "@/lib/supabase";
import { POT_ADDRESS } from "@/lib/wagmi";
import { verifyPaymentTx } from "@/lib/onchain";

export const dynamic = "force-dynamic";

type QuestionRow = { id: string; phrase: string; correct: string; wrong: string };

export async function POST(req: NextRequest) {
  if (!supabase) {
    return Response.json({ error: "db-unconfigured" }, { status: 503 });
  }

  const lang = validateLang(req.nextUrl.searchParams.get("lang"));
  const gameId = gameIdFor(lang);

  const body = (await req.json().catch(() => ({}))) as {
    player?: string;
    paidTxHash?: string;
  };
  const player = body.player?.toLowerCase();
  const paidTxHash =
    body.paidTxHash && /^0x[0-9a-f]{64}$/i.test(body.paidTxHash)
      ? body.paidTxHash.toLowerCase()
      : null;
  if (!player || !/^0x[0-9a-f]{40}$/.test(player)) {
    return Response.json({ error: "invalid-player" }, { status: 400 });
  }

  const day = todayUtc();

  // Only count runs that actually reached a terminal state — orphaned `open`
  // runs (tab closed, reload, network blip) shouldn't burn the free play.
  const { count: todayCount } = await supabase
    .from("runs")
    .select("*", { count: "exact", head: true })
    .eq("lang", lang)
    .eq("day_utc", day)
    .eq("player", player)
    .neq("status", "open");

  // Player has already played today and didn't pay → reject.
  if ((todayCount ?? 0) > 0 && !paidTxHash) {
    return Response.json({ error: "payment-required" }, { status: 402 });
  }

  // When a tx hash is provided, it has to be a real, fresh play() on the
  // deployed contract from this player. Prevents replay (same tx reused) and
  // spoof (random tx hash).
  let potAmountAfter: bigint | null = null;
  if (paidTxHash) {
    if (isAddressEqual(POT_ADDRESS, zeroAddress)) {
      return Response.json(
        { error: "contract-not-deployed" },
        { status: 400 },
      );
    }

    const { data: dup } = await supabase
      .from("runs")
      .select("id")
      .eq("paid_tx_hash", paidTxHash)
      .maybeSingle();
    if (dup) {
      return Response.json({ error: "tx-already-used" }, { status: 400 });
    }

    const check = await verifyPaymentTx(paidTxHash, player, gameId);
    if (!check.valid) {
      return Response.json({ error: check.reason }, { status: 400 });
    }
    potAmountAfter = check.potAfter;
  }

  const wasFree = !paidTxHash && (todayCount ?? 0) === 0;

  const { data: runRow, error: runErr } = await supabase
    .from("runs")
    .insert({
      lang,
      game_id: gameId,
      day_utc: day,
      player,
      was_free: wasFree,
      paid_tx_hash: paidTxHash,
      status: "open",
    })
    .select("id")
    .single();

  if (runErr || !runRow) {
    return Response.json({ error: "failed-to-create-run" }, { status: 500 });
  }
  const runId = (runRow as { id: string }).id;

  if (potAmountAfter !== null) {
    await supabase
      .from("pots")
      .update({ amount_units: potAmountAfter.toString() })
      .eq("lang", lang)
      .eq("day_utc", day);
  }

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
