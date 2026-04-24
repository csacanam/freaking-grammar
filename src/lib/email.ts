// Thin wrapper around Resend's REST API for the daily player emails.
// Exposes sendDailyEmail() that the cron endpoints call per-subscriber.
//
// Why not @resend/node: the package is a thin JSON wrapper too, and
// keeping this to a plain fetch() means no extra dependency surface
// and easier edge-runtime compatibility if we ever move the crons
// there.
//
// Deliverability plumbing baked in:
//  - `text` alternative alongside `html` (spam-filter signal)
//  - List-Unsubscribe + List-Unsubscribe-Post headers per RFC 8058 so
//    Gmail exposes the native "unsubscribe" link and classifies the
//    message as a legitimate list send
//  - HMAC'd unsub token per address (rotating EMAIL_UNSUB_SECRET
//    invalidates every outstanding link)
//  - Hidden preheader block + zero-width filler so inboxes don't leak
//    HTML tag soup into the subject-preview line

import { createHmac, timingSafeEqual } from "node:crypto";
import {
  renderLastCallEmail,
  renderOpenEmail,
  type EmailData,
  type RenderedEmail,
} from "./email-templates";
import type { Lang } from "./i18n";

export type DailyEmailType = "open" | "last-call";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

function appUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ||
    "https://freaking-grammar.vercel.app"
  );
}

function fromHeader(): string {
  return (
    process.env.EMAIL_FROM ||
    "Freaking Grammar <freaking-grammar@sakalabs.io>"
  );
}

function replyToHeader(): string {
  return process.env.EMAIL_REPLY_TO || "hi@sakalabs.io";
}

// Stable per-user HMAC token. Same address always produces the same
// token (as long as EMAIL_UNSUB_SECRET is unchanged), so the link in
// every email points to the same place — makes re-subscribes and
// audit trails simpler. Rotating the secret invalidates all links at
// once, which is the intended nuclear option.
export function buildUnsubToken(address: string): string {
  const secret = process.env.EMAIL_UNSUB_SECRET;
  if (!secret) throw new Error("EMAIL_UNSUB_SECRET not configured");
  return createHmac("sha256", secret)
    .update(address.toLowerCase())
    .digest("hex")
    .slice(0, 32);
}

export function verifyUnsubToken(address: string, token: string): boolean {
  const secret = process.env.EMAIL_UNSUB_SECRET;
  if (!secret) return false;
  const expected = Buffer.from(buildUnsubToken(address));
  const got = Buffer.from(token);
  if (expected.length !== got.length) return false;
  return timingSafeEqual(expected, got);
}

function buildHtmlShell(
  rendered: RenderedEmail,
  unsubUrl: string,
  lang: Lang,
): string {
  const footer =
    lang === "es"
      ? `Recibes esto porque entraste a Freaking Grammar con tu correo.<br><a href="${unsubUrl}" style="color:#9a9a9a;">Darse de baja</a>`
      : `You're getting this because you signed in to Freaking Grammar with your email.<br><a href="${unsubUrl}" style="color:#9a9a9a;">Unsubscribe</a>`;

  const body = rendered.bodyHtml.replace(/__APP__/g, appUrl());
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:32px 16px;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a1a1a;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${rendered.preheader}</div>
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;</div>
<div style="max-width:520px;margin:0 auto;font-size:16px;line-height:1.55;">
${body}
<p style="margin:48px 0 0;color:#9a9a9a;font-size:12px;line-height:1.5;border-top:1px solid #eeeaea;padding-top:16px;">${footer}</p>
</div></body></html>`;
}

export async function sendDailyEmail(params: {
  to: string;
  address: string; // ownership — used to sign the unsub token
  lang: Lang;
  type: DailyEmailType;
  data: EmailData;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "RESEND_API_KEY missing" };
  }

  const rendered =
    params.type === "open"
      ? renderOpenEmail(params.lang, params.data)
      : renderLastCallEmail(params.lang, params.data);

  const unsubToken = buildUnsubToken(params.address);
  const unsubUrl = `${appUrl()}/api/unsubscribe?a=${params.address.toLowerCase()}&t=${unsubToken}`;

  const html = buildHtmlShell(rendered, unsubUrl, params.lang);
  const text = rendered.text.replace(/__APP__/g, appUrl());

  const body = {
    from: fromHeader(),
    to: [params.to],
    reply_to: replyToHeader(),
    subject: rendered.subject,
    html,
    text,
    headers: {
      "List-Unsubscribe": `<${unsubUrl}>, <mailto:unsubscribe@sakalabs.io>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      return {
        ok: false,
        error: `resend ${res.status}: ${errBody.slice(0, 200)}`,
      };
    }
    const json = (await res.json()) as { id?: string };
    return { ok: true, id: json.id };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
