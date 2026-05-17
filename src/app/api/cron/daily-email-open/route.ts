// Fires daily at 00:00 UTC (via cron-job.org) right when a new round
// opens. Sends the "you have a play available" email to every
// subscribed Privy user in their stored language. Pot amounts and
// sponsor bonuses are fetched live so the preheader / body reflect
// the current seed state.
//
// Auth: CRON_SECRET in the Authorization header, same pattern as the
// other crons. Rate-limited by the 350ms sleep between sends to stay
// inside Resend's 2 req/s free-tier cap.
//
// Safety flags for manual testing:
//   ?dry=1           — simulates the full flow (query, data fetch,
//                      template render) but skips the Resend send.
//                      Returns the per-subscriber breakdown so you
//                      can see exactly who would have gotten what.
//   ?only=<email>    — still sends real emails, but filters the
//                      subscriber list down to that one address.
//                      Useful for end-to-end preview on your own
//                      inbox before opening the firehose.
// Once verified, let cron-job.org drive the endpoint unfiltered and
// ignore both flags.

import type { NextRequest } from "next/server";
import { fetchAllPaged, supabase } from "@/lib/supabase";
import { fetchDailyEmailData } from "@/lib/email-data";
import { renderOpenEmail } from "@/lib/email-templates";
import { sendDailyEmail } from "@/lib/email";
import { sendTelegramMessage } from "@/lib/telegram";
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
  const db = supabase;

  const dryRun = req.nextUrl.searchParams.get("dry") === "1";
  const only = req.nextUrl.searchParams.get("only")?.toLowerCase() ?? null;

  // Paginated — welcome_airdrops keeps growing and Supabase silently caps
  // single-page reads at 1000. Without this, subscribers past row 1000
  // would stop getting daily emails the moment we crossed that line.
  let subscribers: Array<{
    address: string;
    email: string;
    lang: Lang | null;
  }>;
  try {
    subscribers = await fetchAllPaged<{
      address: string;
      email: string;
      lang: Lang | null;
    }>((from, to) =>
      db
        .from("welcome_airdrops")
        .select("address,email,lang")
        .eq("email_subscribed", true)
        .not("email", "is", null)
        .range(from, to),
    );
  } catch (e) {
    return Response.json(
      { error: "db-query-failed", detail: (e as Error).message },
      { status: 500 },
    );
  }
  if (only) {
    subscribers = subscribers.filter((s) => s.email.toLowerCase() === only);
    if (subscribers.length === 0) {
      return Response.json(
        { error: "no-subscriber-match", only },
        { status: 404 },
      );
    }
  }
  if (subscribers.length === 0) {
    return Response.json({ sent: 0, note: "no subscribers" });
  }

  const data = await fetchDailyEmailData();

  if (dryRun) {
    const preview = subscribers.slice(0, 10).map((s) => {
      const lang = (s.lang === "en" || s.lang === "es" ? s.lang : "es") as Lang;
      const rendered = renderOpenEmail(lang, data);
      return {
        email: s.email,
        lang,
        subject: rendered.subject,
        preheader: rendered.preheader,
      };
    });
    return Response.json({
      dryRun: true,
      total: subscribers.length,
      previewFirst: preview,
      data,
    });
  }

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

  // Best-effort telegram ping so the operator knows the cron fired
  // without opening Resend. Failures are already captured above.
  notifyOpenRun({
    total: subscribers.length,
    sent,
    failed: failures.length,
    only,
  }).catch((e) => console.error("daily-email-open telegram failed:", e));

  return Response.json({
    total: subscribers.length,
    sent,
    failed: failures.length,
    failures: failures.slice(0, 10),
    only,
  });
}

async function notifyOpenRun(args: {
  total: number;
  sent: number;
  failed: number;
  only: string | null;
}) {
  const lines = [
    "*📧 Daily email — open*",
    args.only ? `🎯 only: \`${args.only}\`` : null,
    `📨 ${args.sent}/${args.total} sent${args.failed > 0 ? ` · ${args.failed} failed` : ""}`,
  ].filter((l): l is string => l !== null);
  await sendTelegramMessage(lines.join("\n"));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
