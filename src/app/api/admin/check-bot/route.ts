// Dry-run wrapper for the same bot filter `roll-day` uses, so we can
// spot-check a wallet (or audit a near-miss) without firing the daily
// settlement. Gated by CRON_SECRET like the rest of /admin.

import type { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";
import { checkBotPlayer } from "@/lib/bot-detection";

export const dynamic = "force-dynamic";

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

  const player = req.nextUrl.searchParams.get("player")?.toLowerCase();
  if (!player || !/^0x[0-9a-f]{40}$/.test(player)) {
    return Response.json({ error: "bad-player" }, { status: 400 });
  }

  const flag = await checkBotPlayer(player, supabase);
  return Response.json({ player, ...flag });
}
