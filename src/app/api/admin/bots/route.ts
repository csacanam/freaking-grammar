// Read/write the bot_wallets table from outside Supabase.
//
// GET    → list every flagged wallet (manual + auto), newest first.
// DELETE → remove one (?player=0x...) so a false-positive can be reversed.
//
// Both gated by CRON_SECRET. There is no POST: manual additions go via
// SQL or the heuristic. We don't want a "ban any wallet via HTTP"
// surface area unless we genuinely need it later.

import type { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

function checkAuth(req: NextRequest): Response | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return null;
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}

export async function GET(req: NextRequest) {
  const unauth = checkAuth(req);
  if (unauth) return unauth;
  if (!supabase) {
    return Response.json({ error: "db-unconfigured" }, { status: 503 });
  }

  const { data, error } = await supabase
    .from("bot_wallets")
    .select("*")
    .order("flagged_at", { ascending: false });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({
    count: (data ?? []).length,
    wallets: data ?? [],
  });
}

export async function DELETE(req: NextRequest) {
  const unauth = checkAuth(req);
  if (unauth) return unauth;
  if (!supabase) {
    return Response.json({ error: "db-unconfigured" }, { status: 503 });
  }

  const player = req.nextUrl.searchParams.get("player")?.toLowerCase();
  if (!player || !/^0x[0-9a-f]{40}$/.test(player)) {
    return Response.json({ error: "bad-player" }, { status: 400 });
  }

  const { error, count } = await supabase
    .from("bot_wallets")
    .delete({ count: "exact" })
    .eq("player", player);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ player, removed: count ?? 0 });
}
