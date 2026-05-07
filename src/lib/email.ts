// Thin wrapper around either Resend or SendGrid for the daily player
// emails. Exposes sendDailyEmail() that the cron endpoints call per-
// subscriber. Provider chosen at runtime by env: SENDGRID_API_KEY wins
// if set, otherwise falls back to RESEND_API_KEY. Lets you flip back
// to Resend without a redeploy by clearing SENDGRID_API_KEY in Vercel.
//
// Why not the official SDK packages: each is just a JSON wrapper, and
// staying on plain fetch() keeps the bundle small and edge-runtime
// portable if we ever move the crons there.
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
const SENDGRID_ENDPOINT = "https://api.sendgrid.com/v3/mail/send";

function appUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ||
    "https://nerdos.fun"
  );
}

function fromHeader(): string {
  return process.env.EMAIL_FROM || "nerdos.fun <hi@sakalabs.io>";
}

function replyToHeader(): string {
  return process.env.EMAIL_REPLY_TO || "hi@sakalabs.io";
}

// SendGrid wants `from` as a structured object {email, name}, not the
// "Name <email>" string Resend takes. Parse the EMAIL_FROM env value
// once into both shapes.
function parseFromHeader(): { email: string; name?: string } {
  const raw = fromHeader().trim();
  const m = raw.match(/^(.*)<([^>]+)>$/);
  if (!m) return { email: raw };
  return { email: m[2].trim(), name: m[1].trim().replace(/^"|"$/g, "") };
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
      ? `Recibes esto porque entraste a nerdos.fun con tu correo.<br><a href="${unsubUrl}" style="color:#9a9a9a;">Darse de baja</a>`
      : `You're getting this because you signed in to nerdos.fun with your email.<br><a href="${unsubUrl}" style="color:#9a9a9a;">Unsubscribe</a>`;

  // The Grammar email funnels users straight into /grammar, not the
  // platform picker. When Math ships its own daily email it'll use a
  // /math placeholder instead.
  const playUrl = `${appUrl()}/grammar`;
  const body = rendered.bodyHtml.replace(/__APP__/g, playUrl);
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
}): Promise<{ ok: boolean; id?: string; error?: string; provider?: string }> {
  const sendgridKey = process.env.SENDGRID_API_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  if (!sendgridKey && !resendKey) {
    return { ok: false, error: "no email provider configured" };
  }

  const rendered =
    params.type === "open"
      ? renderOpenEmail(params.lang, params.data)
      : renderLastCallEmail(params.lang, params.data);

  const unsubToken = buildUnsubToken(params.address);
  const unsubUrl = `${appUrl()}/api/unsubscribe?a=${params.address.toLowerCase()}&t=${unsubToken}`;

  const html = buildHtmlShell(rendered, unsubUrl, params.lang);
  const text = rendered.text.replace(/__APP__/g, `${appUrl()}/grammar`);

  // SendGrid wins when both keys are present so a Vercel env-var swap
  // (clearing SENDGRID_API_KEY) is the rollback lever.
  if (sendgridKey) {
    return sendViaSendGrid({
      apiKey: sendgridKey,
      to: params.to,
      subject: rendered.subject,
      html,
      text,
      unsubUrl,
    });
  }
  return sendViaResend({
    apiKey: resendKey!,
    to: params.to,
    subject: rendered.subject,
    html,
    text,
    unsubUrl,
  });
}

type SendArgs = {
  apiKey: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  unsubUrl: string;
};

async function sendViaSendGrid(
  args: SendArgs,
): Promise<{ ok: boolean; id?: string; error?: string; provider: string }> {
  const from = parseFromHeader();
  const body = {
    personalizations: [
      {
        to: [{ email: args.to }],
        // SendGrid supports per-personalization custom headers, but
        // the global `headers` field below is simpler and applies the
        // RFC 8058 unsubscribe headers to every recipient.
      },
    ],
    from,
    reply_to: { email: replyToHeader() },
    subject: args.subject,
    content: [
      { type: "text/plain", value: args.text },
      { type: "text/html", value: args.html },
    ],
    headers: {
      "List-Unsubscribe": `<${args.unsubUrl}>, <mailto:unsubscribe@sakalabs.io>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
    // Disable SendGrid's click + open tracking — the link rewriting it
    // does breaks the unsubscribe URL signing (the token is part of the
    // query string and click-tracking proxies the URL).
    tracking_settings: {
      click_tracking: { enable: false, enable_text: false },
      open_tracking: { enable: false },
    },
  };

  try {
    const res = await fetch(SENDGRID_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      return {
        ok: false,
        error: `sendgrid ${res.status}: ${errBody.slice(0, 300)}`,
        provider: "sendgrid",
      };
    }
    // SendGrid returns 202 + empty body on success; the message id
    // lives in the `X-Message-Id` response header.
    const id = res.headers.get("x-message-id") ?? undefined;
    return { ok: true, id, provider: "sendgrid" };
  } catch (e) {
    return {
      ok: false,
      error: (e as Error).message,
      provider: "sendgrid",
    };
  }
}

async function sendViaResend(
  args: SendArgs,
): Promise<{ ok: boolean; id?: string; error?: string; provider: string }> {
  const body = {
    from: fromHeader(),
    to: [args.to],
    reply_to: replyToHeader(),
    subject: args.subject,
    html: args.html,
    text: args.text,
    headers: {
      "List-Unsubscribe": `<${args.unsubUrl}>, <mailto:unsubscribe@sakalabs.io>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      return {
        ok: false,
        error: `resend ${res.status}: ${errBody.slice(0, 200)}`,
        provider: "resend",
      };
    }
    const json = (await res.json()) as { id?: string };
    return { ok: true, id: json.id, provider: "resend" };
  } catch (e) {
    return {
      ok: false,
      error: (e as Error).message,
      provider: "resend",
    };
  }
}
