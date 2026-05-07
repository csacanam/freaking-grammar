// Mark a Math run as finished/abandoned and compute final rank. Same
// shape as Grammar's finish endpoint.

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
    .select("player,score,status,day_utc,game")
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
    game: string;
  };
  if (run.game !== "math") {
    return Response.json({ error: "not-a-math-run" }, { status: 400 });
  }

  if (run.status === "open") {
    await supabase
      .from("runs")
      .update({
        status: reason === "abandoned" ? "abandoned" : "finished",
        ended_at: new Date().toISOString(),
      })
      .eq("id", runId);
  }

  const rank = await computeRank(
    { game: "math" },
    run.day_utc,
    run.player,
    run.score,
  );
  return Response.json({ score: run.score, rank });
}
