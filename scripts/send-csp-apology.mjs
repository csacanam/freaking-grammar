// One-off apology email to the 18 users hit by the CSP-vs-Turnstile
// regression (commit 96ad710 + 18e42f5). Body is intentionally vague —
// no token names, no amounts, no transaction links. Just "your account
// couldn't play, we fixed it." Lang-agnostic because we never captured
// `lang` for these refunds (welcome_airdrops.lang is null for all 18)
// and Privy doesn't expose user locale, so the body stacks EN + ES in
// a single message.
//
// Sends via SendGrid if SENDGRID_API_KEY is set, else Resend (mirrors
// lib/email.ts provider precedence). No HMAC unsub link (the local
// EMAIL_UNSUB_SECRET would sign tokens that production's
// /api/unsubscribe rejects); only the mailto: List-Unsubscribe variant
// is set, which is enough for Gmail to surface the native unsubscribe
// action.
//
// Usage:
//   node scripts/send-csp-apology.mjs --file affected.json
//   node scripts/send-csp-apology.mjs --file affected.json --execute
//   node scripts/send-csp-apology.mjs --file affected.json --execute --only user@example.com

import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const RESEND_KEY = env.RESEND_API_KEY;
const SENDGRID_KEY = env.SENDGRID_API_KEY;
const FROM = env.EMAIL_FROM || "nerdos.fun <hi@sakalabs.io>";
const REPLY_TO = env.EMAIL_REPLY_TO || "hi@sakalabs.io";
const SITE = (env.NEXT_PUBLIC_SITE_URL || "https://nerdos.fun").replace(/\/+$/, "");

if (!RESEND_KEY && !SENDGRID_KEY) {
  console.error("No email provider configured (RESEND_API_KEY or SENDGRID_API_KEY).");
  process.exit(1);
}

const argv = process.argv.slice(2);
const execute = argv.includes("--execute");
const fileIdx = argv.indexOf("--file");
const filePath = fileIdx >= 0 ? argv[fileIdx + 1] : null;
const onlyIdx = argv.indexOf("--only");
const only = onlyIdx >= 0 ? argv[onlyIdx + 1]?.toLowerCase() : null;

if (!filePath) {
  console.error("Pass --file <path-to-affected.json>");
  process.exit(1);
}

const raw = JSON.parse(readFileSync(filePath, "utf8"));
const entries = (Array.isArray(raw) ? raw : [])
  .map((e) => ({
    email: e.email,
  }))
  .filter((e) => e.email)
  .filter((e) => (only ? e.email.toLowerCase() === only : true));

if (entries.length === 0) {
  console.error("No valid recipients found.");
  process.exit(1);
}

const provider = SENDGRID_KEY ? "sendgrid" : "resend";
const message = renderBilingual();

console.log("Mode:        ", execute ? "EXECUTE (will send emails)" : "DRY-RUN");
console.log("Provider:    ", provider);
console.log("Recipients:  ", entries.length);
console.log("Subject:     ", message.subject);
console.log("");

let sent = 0;
let failed = 0;

for (let i = 0; i < entries.length; i++) {
  const { email } = entries[i];

  if (!execute) {
    console.log(`${email.padEnd(40)}  would-send`);
    continue;
  }

  const res =
    provider === "sendgrid"
      ? await sendViaSendGrid({ to: email, ...message })
      : await sendViaResend({ to: email, ...message });

  if (res.ok) {
    console.log(`${email.padEnd(40)}  sent  id=${res.id ?? "-"}`);
    sent++;
  } else {
    console.error(`${email.padEnd(40)}  failed  ${res.error}`);
    failed++;
  }

  // ~3 emails/sec to stay polite with Resend's free tier.
  if (i < entries.length - 1) await sleep(350);
}

console.log("");
console.log("=== summary ===");
console.log("sent:    ", sent);
console.log("failed:  ", failed);
if (!execute) console.log("(dry-run — re-run with --execute to actually send)");

// -----------------------------------------------------------------------

function renderBilingual() {
  const subject = "Your nerdos.fun account is ready · Tu cuenta de nerdos.fun ya está lista";
  const preheader = "We noticed you couldn't play and we fixed it · Vimos que no podías jugar y ya lo arreglamos";

  const bodyHtml = [
    // EN first
    `<p style="margin:0 0 12px;">Hi,</p>`,
    `<p style="margin:0 0 16px;">We noticed something went wrong when you signed up at <a href="${SITE}" style="color:#1a8060;">nerdos.fun</a> in the last few days — your account couldn't play.</p>`,
    `<p style="margin:0 0 16px;">We've fixed it. Your account is ready to go now.</p>`,
    `<p style="margin:0 0 24px;"><a href="${SITE}" style="color:#1a8060;font-weight:600;">Play →</a></p>`,
    `<p style="margin:0 0 8px;">Thanks for your patience.</p>`,
    `<p style="margin:0;">— nerdos.fun</p>`,
    // Divider
    `<hr style="margin:32px 0;border:none;border-top:1px solid #eeeaea;">`,
    // ES
    `<p style="margin:0 0 12px;">Hola,</p>`,
    `<p style="margin:0 0 16px;">Vimos que algo salió mal cuando te registraste en <a href="${SITE}" style="color:#1a8060;">nerdos.fun</a> en los últimos días: tu cuenta no podía jugar.</p>`,
    `<p style="margin:0 0 16px;">Ya lo arreglamos. Tu cuenta está lista.</p>`,
    `<p style="margin:0 0 24px;"><a href="${SITE}" style="color:#1a8060;font-weight:600;">Jugar →</a></p>`,
    `<p style="margin:0 0 8px;">Gracias por la paciencia.</p>`,
    `<p style="margin:0;">— nerdos.fun</p>`,
  ].join("");

  const text = [
    `Hi,`,
    ``,
    `We noticed something went wrong when you signed up at nerdos.fun in the last few days — your account couldn't play.`,
    ``,
    `We've fixed it. Your account is ready to go now.`,
    ``,
    `Play: ${SITE}`,
    ``,
    `Thanks for your patience.`,
    `— nerdos.fun`,
    ``,
    `---`,
    ``,
    `Hola,`,
    ``,
    `Vimos que algo salió mal cuando te registraste en nerdos.fun en los últimos días: tu cuenta no podía jugar.`,
    ``,
    `Ya lo arreglamos. Tu cuenta está lista.`,
    ``,
    `Jugar: ${SITE}`,
    ``,
    `Gracias por la paciencia.`,
    `— nerdos.fun`,
  ].join("\n");

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:32px 16px;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a1a1a;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${preheader}</div>
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;</div>
<div style="max-width:520px;margin:0 auto;font-size:16px;line-height:1.55;">
${bodyHtml}
</div></body></html>`;

  return { subject, html, text };
}

async function sendViaSendGrid({ to, subject, html, text }) {
  const m = FROM.trim().match(/^(.*)<([^>]+)>$/);
  const from = m ? { email: m[2].trim(), name: m[1].trim().replace(/^"|"$/g, "") } : { email: FROM };
  const body = {
    personalizations: [{ to: [{ email: to }] }],
    from,
    reply_to: { email: REPLY_TO },
    subject,
    content: [
      { type: "text/plain", value: text },
      { type: "text/html", value: html },
    ],
    headers: {
      "List-Unsubscribe": `<mailto:unsubscribe@sakalabs.io>`,
    },
    tracking_settings: {
      click_tracking: { enable: false, enable_text: false },
      open_tracking: { enable: false },
    },
  };
  try {
    const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SENDGRID_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      return { ok: false, error: `sendgrid ${res.status}: ${errBody.slice(0, 300)}` };
    }
    return { ok: true, id: res.headers.get("x-message-id") ?? undefined };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function sendViaResend({ to, subject, html, text }) {
  const body = {
    from: FROM,
    to: [to],
    reply_to: REPLY_TO,
    subject,
    html,
    text,
    headers: {
      "List-Unsubscribe": `<mailto:unsubscribe@sakalabs.io>`,
    },
  };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      return { ok: false, error: `resend ${res.status}: ${errBody.slice(0, 200)}` };
    }
    const json = await res.json();
    return { ok: true, id: json.id };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
