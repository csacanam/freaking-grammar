// Fires daily at 22:00 UTC (via cron-job.org) — two hours before the
// round closes. Sends the urgency email ONLY to subscribers who
// haven't played either game today, so users who already put up a
// score don't get pinged. Body shows top scores to beat + prize per
// game + sponsor bonuses; preheader shows the summed totals.

import type { NextRequest } from "next/server";
import { supabase, todayUtc } from "@/lib/supabase";
import { fetchDailyEmailData } from "@/lib/email-data";
import { sendDailyEmail } from "@/lib/email";
import type { Lang } from "@/lib/i18n";

export const dynamic = "force-dynamic";

const SEND_SPACING_MS = 350;

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
  if (!process.env.RESEND_API_KEY) {
    return Response.json({ error: "resend-unconfigured" }, { status: 503 });
  }

  const day = todayUtc();

  // Every subscriber...
  const { data: subs, error: subsErr } = await supabase
    .from("welcome_airdrops")
    .select("address,email,lang")
    .eq("email_subscribed", true)
    .not("email", "is", null);
  if (subsErr) {
    return Response.json(
      { error: "db-query-failed", detail: subsErr.message },
      { status: 500 },
    );
  }

  // ...minus anyone who already has at least one finished run today.
  // `open` rows don't count — a user who started but bailed without
  // finishing still deserves the nudge.
  const { data: playedToday } = await supabase
    .from("runs")
    .select("player")
    .eq("day_utc", day)
    .eq("status", "finished");
  const playedSet = new Set(
    ((playedToday ?? []) as Array<{ player: string }>).map((r) =>
      r.player.toLowerCase(),
    ),
  );

  const subscribers = ((subs ?? []) as Array<{
    address: string;
    email: string;
    lang: Lang | null;
  }>).filter((s) => !playedSet.has(s.address.toLowerCase()));

  if (subscribers.length === 0) {
    return Response.json({
      sent: 0,
      note: "every subscriber already played today",
    });
  }

  const data = await fetchDailyEmailData();

  let sent = 0;
  const failures: Array<{ email: string; error: string }> = [];
  for (let i = 0; i < subscribers.length; i++) {
    const s = subscribers[i];
    const lang = (s.lang === "en" || s.lang === "es" ? s.lang : "es") as Lang;
    const res = await sendDailyEmail({
      to: s.email,
      address: s.address,
      lang,
      type: "last-call",
      data,
    });
    if (res.ok) sent += 1;
    else failures.push({ email: s.email, error: res.error ?? "unknown" });
    if (i < subscribers.length - 1) {
      await sleep(SEND_SPACING_MS);
    }
  }

  return Response.json({
    eligible: subscribers.length,
    sent,
    failed: failures.length,
    failures: failures.slice(0, 10),
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
