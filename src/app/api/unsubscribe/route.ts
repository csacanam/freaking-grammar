// One-click unsubscribe for the daily player emails. Exposes both GET
// (for footer links — renders a confirmation page) and POST (for
// RFC 8058 List-Unsubscribe-Post=One-Click headers, which Gmail /
// Apple Mail hit programmatically when the user taps the native
// Unsubscribe button above the email).
//
// Security: the `t` token is HMAC'd from the address with
// EMAIL_UNSUB_SECRET. Address alone isn't enough — without the
// secret the attacker can't produce a valid token, so the endpoint
// can't be weaponised to mass-unsubscribe the user base. On
// verification we just flip email_subscribed=false in supabase.

import type { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";
import { verifyUnsubToken } from "@/lib/email";

export const dynamic = "force-dynamic";

async function flipSubscription(
  address: string,
  token: string,
): Promise<{ ok: boolean; status: number; message: string }> {
  if (!supabase) {
    return { ok: false, status: 503, message: "Database not configured." };
  }
  const addr = address.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(addr)) {
    return { ok: false, status: 400, message: "Invalid address." };
  }
  if (!verifyUnsubToken(addr, token)) {
    return { ok: false, status: 403, message: "Invalid or expired link." };
  }
  const { error } = await supabase
    .from("welcome_airdrops")
    .update({ email_subscribed: false })
    .eq("address", addr);
  if (error) {
    return { ok: false, status: 500, message: error.message };
  }
  return { ok: true, status: 200, message: "Unsubscribed successfully." };
}

function confirmationHtml(message: string, ok: boolean): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Freaking Grammar — Unsubscribe</title></head>
<body style="margin:0;padding:48px 16px;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a1a1a;">
<div style="max-width:440px;margin:0 auto;text-align:center;font-size:16px;line-height:1.55;">
<h1 style="font-size:22px;margin:0 0 16px;">${ok ? "You're unsubscribed" : "Something went wrong"}</h1>
<p style="margin:0 0 24px;color:${ok ? "#1a1a1a" : "#a03030"};">${escape(message)}</p>
<p style="margin:32px 0 0;font-size:13px;color:#9a9a9a;">
${ok ? "You won't receive any more daily Freaking Grammar emails." : "Head to your inbox and try the link again, or contact hi@sakalabs.io if it keeps failing."}
</p>
</div></body></html>`;
}

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function GET(req: NextRequest) {
  const addr = req.nextUrl.searchParams.get("a") ?? "";
  const token = req.nextUrl.searchParams.get("t") ?? "";
  const result = await flipSubscription(addr, token);
  return new Response(confirmationHtml(result.message, result.ok), {
    status: result.status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

// RFC 8058: Gmail / Apple Mail POST to the List-Unsubscribe URL for
// the native inbox "Unsubscribe" button. Same verification path as
// GET; returns JSON because a browser isn't rendering this.
export async function POST(req: NextRequest) {
  const addr = req.nextUrl.searchParams.get("a") ?? "";
  const token = req.nextUrl.searchParams.get("t") ?? "";
  const result = await flipSubscription(addr, token);
  return Response.json(
    { ok: result.ok, message: result.message },
    { status: result.status },
  );
}
