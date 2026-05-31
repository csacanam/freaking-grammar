// Fires daily at 22:00 UTC (via cron-job.org) — two hours before the
// round closes. Sends the urgency email ONLY to subscribers who
// haven't played either game today, so users who already put up a
// score don't get pinged. Body shows top scores to beat + prize per
// game + sponsor bonuses; preheader shows the summed totals.
//
// Safety flags for manual testing:
//   ?dry=1           — simulates everything (subscriber filter,
//                      data fetch, render) without calling Resend
//   ?only=<email>    — sends real, but only to that one address
//   ?force=1         — skips the "already played today" filter so
//                      you can preview the template on yourself even
//                      after you've used your free play. Only useful
//                      with ?only=, so cron-job.org unfiltered calls
//                      keep respecting engagement state.

import type { NextRequest } from "next/server";
import { fetchAllPaged, supabase, todayUtc } from "@/lib/supabase";
import { fetchDailyEmailData } from "@/lib/email-data";
import { renderLastCallEmail } from "@/lib/email-templates";
import { sendDailyEmail } from "@/lib/email";
import { sendTelegramMessage } from "@/lib/telegram";
import type { Lang } from "@/lib/i18n";

export const dynamic = "force-dynamic";

// Same rationale as daily-email-open/route.ts: the old 1-by-1 loop with
// a 350ms sleep blew cron-job.org's 30s timeout the moment subscribers
// crossed ~85 rows, so most runs only flushed the first slice before
// being killed. SendGrid handles 100/sec on the free tier, so 20
// concurrent sends per batch is well under that ceiling.
const SEND_BATCH_SIZE = 20;

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
  const force = req.nextUrl.searchParams.get("force") === "1";

  const day = todayUtc();

  // Every subscriber. Paginated because welcome_airdrops keeps growing
  // and the 1000-row Supabase cap would silently drop subscribers from
  // the daily send the moment we crossed it.
  let allSubs: Array<{
    address: string;
    email: string;
    lang: Lang | null;
  }>;
  try {
    allSubs = await fetchAllPaged<{
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

  // ...minus anyone who already has at least one finished run today.
  // `open` rows don't count — a user who started but bailed without
  // finishing still deserves the nudge. (Single-day filter keeps this
  // well under the cap for the foreseeable future.)
  const { data: playedToday } = await db
    .from("runs")
    .select("player")
    .eq("day_utc", day)
    .eq("status", "finished");
  const playedSet = new Set(
    ((playedToday ?? []) as Array<{ player: string }>).map((r) =>
      r.player.toLowerCase(),
    ),
  );
  let subscribers = force
    ? allSubs
    : allSubs.filter((s) => !playedSet.has(s.address.toLowerCase()));

  const totalSubs = allSubs.length;
  const skippedBecausePlayed = force ? 0 : totalSubs - subscribers.length;

  if (only) {
    subscribers = subscribers.filter((s) => s.email.toLowerCase() === only);
    if (subscribers.length === 0) {
      return Response.json(
        {
          error: "no-subscriber-match-or-already-played",
          only,
          hint: "Either the email isn't in welcome_airdrops, or that user already played today (and last-call skips them by design).",
        },
        { status: 404 },
      );
    }
  }

  if (subscribers.length === 0) {
    return Response.json({
      sent: 0,
      note: "every subscriber already played today",
    });
  }

  const data = await fetchDailyEmailData();

  if (dryRun) {
    const preview = subscribers.slice(0, 10).map((s) => {
      const lang = (s.lang === "en" || s.lang === "es" ? s.lang : "es") as Lang;
      const rendered = renderLastCallEmail(lang, data);
      return {
        email: s.email,
        lang,
        subject: rendered.subject,
        preheader: rendered.preheader,
      };
    });
    return Response.json({
      dryRun: true,
      totalSubs,
      skippedBecausePlayed,
      eligible: subscribers.length,
      previewFirst: preview,
      data,
    });
  }

  let sent = 0;
  const failures: Array<{ email: string; error: string }> = [];
  for (let i = 0; i < subscribers.length; i += SEND_BATCH_SIZE) {
    const batch = subscribers.slice(i, i + SEND_BATCH_SIZE);
    const results = await Promise.all(
      batch.map((s) => {
        const lang = (s.lang === "en" || s.lang === "es"
          ? s.lang
          : "es") as Lang;
        return sendDailyEmail({
          to: s.email,
          address: s.address,
          lang,
          type: "last-call",
          data,
        }).then((res) => ({ email: s.email, res }));
      }),
    );
    for (const { email, res } of results) {
      if (res.ok) sent += 1;
      else failures.push({ email, error: res.error ?? "unknown" });
    }
  }

  notifyLastCallRun({
    eligible: subscribers.length,
    sent,
    failed: failures.length,
    skippedBecausePlayed,
    only,
  }).catch((e) => console.error("daily-email-last-call telegram failed:", e));

  return Response.json({
    eligible: subscribers.length,
    sent,
    failed: failures.length,
    failures: failures.slice(0, 10),
    skippedBecausePlayed,
    only,
  });
}

async function notifyLastCallRun(args: {
  eligible: number;
  sent: number;
  failed: number;
  skippedBecausePlayed: number;
  only: string | null;
}) {
  const lines = [
    "*📧 Daily email — last call*",
    args.only ? `🎯 only: \`${args.only}\`` : null,
    `📨 ${args.sent}/${args.eligible} sent${args.failed > 0 ? ` · ${args.failed} failed` : ""}`,
    args.skippedBecausePlayed > 0
      ? `🎮 ${args.skippedBecausePlayed} already played — no ping`
      : null,
  ].filter((l): l is string => l !== null);
  await sendTelegramMessage(lines.join("\n"));
}
