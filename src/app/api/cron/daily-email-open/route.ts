// Fires daily at 00:00 UTC (via cron-job.org) right when a new round
// opens. Sends the "you have a play available" email to every
// subscribed Privy user in their stored language. Pot amounts and
// sponsor bonuses are fetched live so the preheader / body reflect
// the current seed state.
//
// Auth: CRON_SECRET in the Authorization header, same pattern as the
// other crons. Rate-limited naturally by the 300ms sleep between
// sends to stay inside Resend's 2 req/s free-tier cap.

import type { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";
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

  const { data: subs, error } = await supabase
    .from("welcome_airdrops")
    .select("address,email,lang")
    .eq("email_subscribed", true)
    .not("email", "is", null);
  if (error) {
    return Response.json(
      { error: "db-query-failed", detail: error.message },
      { status: 500 },
    );
  }

  const subscribers = (subs ?? []) as Array<{
    address: string;
    email: string;
    lang: Lang | null;
  }>;
  if (subscribers.length === 0) {
    return Response.json({ sent: 0, note: "no subscribers" });
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
      type: "open",
      data,
    });
    if (res.ok) sent += 1;
    else failures.push({ email: s.email, error: res.error ?? "unknown" });
    if (i < subscribers.length - 1) {
      await sleep(SEND_SPACING_MS);
    }
  }

  return Response.json({
    total: subscribers.length,
    sent,
    failed: failures.length,
    failures: failures.slice(0, 10),
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
