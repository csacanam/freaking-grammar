// Server-side verification helper for Cloudflare Turnstile.
// https://developers.cloudflare.com/turnstile/get-started/server-side-validation
//
// Defensive default: when TURNSTILE_SECRET_KEY isn't configured, this
// helper returns `{ ok: true, skipped: true }` so the app keeps
// working in dev / first-deploy environments without the captcha.
// In production the env var must be set or every signup gets a free
// pass — surface in /stats or an alert if that ever flips to "always
// skipped".

type TurnstileVerifyResponse = {
  success: boolean;
  "error-codes"?: string[];
  hostname?: string;
  action?: string;
  cdata?: string;
};

export async function verifyTurnstile(
  token: string | undefined,
  remoteIp?: string,
): Promise<{ ok: true; skipped: boolean } | { ok: false; reason: string }> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    // No-op until the env is configured. Logged once so it's obvious
    // in Vercel logs that the captcha is currently a pass-through.
    if (process.env.NODE_ENV === "production") {
      console.warn("[turnstile] secret not configured — skipping verification");
    }
    return { ok: true, skipped: true };
  }

  if (!token) {
    return { ok: false, reason: "missing-token" };
  }

  const params = new URLSearchParams({ secret, response: token });
  if (remoteIp) params.set("remoteip", remoteIp);

  try {
    const res = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      },
    );
    const json = (await res.json()) as TurnstileVerifyResponse;
    if (!json.success) {
      return {
        ok: false,
        reason: json["error-codes"]?.join(",") ?? "verify-failed",
      };
    }
    return { ok: true, skipped: false };
  } catch (e) {
    console.error("[turnstile] verify threw:", e);
    return { ok: false, reason: "verify-threw" };
  }
}
