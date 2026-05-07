// Start a Freaking Math run. Mirror of /api/runs (Grammar's start
// endpoint) with three differences:
//   1. gameId is fixed to 3 (Math, no language split). The Grammar
//      version is parameterised on lang because EN/ES are separate
//      contract pots; Math is one pot for everyone.
//   2. No question bank — equations are synthesized per call. The
//      first equation (q_index=0) is generated and stored alongside
//      its `truth` flag so the answer endpoint can validate without
//      trusting the client.
//   3. Idempotency mirrors Grammar: if the same paid_tx_hash is
//      replayed and the run is still untouched, return the same first
//      equation instead of erroring. Covers double-mounts / reloads
//      during the briefing screen.

import type { NextRequest } from "next/server";
import { isAddressEqual, zeroAddress } from "viem";
import { supabase, todayUtc } from "@/lib/supabase";
import { POT_ADDRESS } from "@/lib/chain";
import { verifyPaymentTx } from "@/lib/onchain";
import { generateMathQuestion } from "@/lib/math-questions";

export const dynamic = "force-dynamic";

const MATH_GAME_ID = 3;

export async function POST(req: NextRequest) {
  if (!supabase) {
    return Response.json({ error: "db-unconfigured" }, { status: 503 });
  }
  if (isAddressEqual(POT_ADDRESS, zeroAddress)) {
    return Response.json({ error: "contract-not-deployed" }, { status: 503 });
  }

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

  // Idempotent replay handling: if a run already exists for this txHash
  // and is still on q_index=0 with no answer, return the existing
  // equation. Anything past q_index=0 or status != open → reject.
  const { data: dup } = await supabase
    .from("runs")
    .select("id,status,game")
    .eq("paid_tx_hash", txHash)
    .maybeSingle();
  if (dup) {
    const dupRow = dup as { id: string; status: string; game: string };
    if (dupRow.game !== "math") {
      return Response.json({ error: "tx-already-used" }, { status: 400 });
    }
    if (dupRow.status !== "open") {
      return Response.json({ error: "tx-already-used" }, { status: 400 });
    }

    const { data: rqData } = await supabase
      .from("run_questions")
      .select("q_index,answered_at,math_left,math_right,math_op,math_shown")
      .eq("run_id", dupRow.id)
      .order("q_index", { ascending: true });
    const rqs = (rqData ?? []) as Array<{
      q_index: number;
      answered_at: string | null;
      math_left: number | null;
      math_right: number | null;
      math_op: string | null;
      math_shown: number | null;
    }>;
    const anyAnswered = rqs.some((r) => r.answered_at !== null);
    if (anyAnswered) {
      return Response.json({ error: "tx-already-used" }, { status: 400 });
    }

    const first = rqs[0];
    if (
      !first ||
      first.math_left === null ||
      first.math_right === null ||
      first.math_op === null ||
      first.math_shown === null
    ) {
      return Response.json({ error: "tx-already-used" }, { status: 400 });
    }
    return Response.json({
      runId: dupRow.id,
      question: {
        left: first.math_left,
        right: first.math_right,
        op: first.math_op,
        shown: first.math_shown,
      },
    });
  }

  const check = await verifyPaymentTx(txHash, player, MATH_GAME_ID);
  if (!check.valid) {
    return Response.json({ error: check.reason }, { status: 400 });
  }
  const potAmountAfter = check.potAfter;
  const wasFree = check.wasFree;

  const { data: runRow, error: runErr } = await supabase
    .from("runs")
    .insert({
      game: "math",
      game_id: MATH_GAME_ID,
      lang: null, // Math has no language; PK lives on game_id, not lang
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

  // Mirror the on-chain pot snapshot to the Math row.
  await supabase
    .from("pots")
    .update({ amount_units: potAmountAfter.toString() })
    .eq("game", "math")
    .eq("day_utc", day);

  const q = generateMathQuestion(0);
  await supabase.from("run_questions").insert({
    run_id: runId,
    q_index: 0,
    math_left: q.left,
    math_right: q.right,
    math_op: q.op,
    math_shown: q.shown,
    math_truth: q.truth,
  });

  return Response.json({
    runId,
    question: {
      left: q.left,
      right: q.right,
      op: q.op,
      shown: q.shown,
    },
  });
}
