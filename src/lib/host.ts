// Detects the runtime host so we can switch chain/payment UX without user
// action and tag acquisition source for analytics. PostHog's auto-captured
// $initial_referring_domain dies inside iframes (Farcaster, Telegram), so
// the explicit signals here cover what referrer can't.

export type Host =
  | "minipay"
  | "farcaster"
  | "base"
  | "telegram"
  | "web";

export function detectHost(): Host {
  if (typeof window === "undefined") return "web";
  const eth = (window as unknown as { ethereum?: { isMiniPay?: boolean } }).ethereum;
  if (eth?.isMiniPay) return "minipay";

  // Telegram mini-apps inject a Telegram.WebApp object on window before
  // any user code runs. initData is a non-empty string only inside a
  // real Telegram launch — visiting the URL in a normal browser leaves
  // the SDK shimmed but with empty initData.
  const tg = (window as unknown as {
    Telegram?: { WebApp?: { initData?: string } };
  }).Telegram;
  if (tg?.WebApp?.initData) return "telegram";

  const ua = navigator.userAgent || "";
  if (/Warpcast|Farcaster/i.test(ua)) return "farcaster";
  if (/CoinbaseWallet|Base\/.+/i.test(ua)) return "base";

  // Iframe + parent origin signals that user agent doesn't always carry.
  // Farcaster Frames embed nerdos.fun via warpcast.com / farcaster.xyz
  // so the referrer points at the host even when the UA is generic.
  try {
    if (window.parent !== window) {
      const ref = document.referrer || "";
      if (/warpcast\.com|farcaster\.xyz/i.test(ref)) return "farcaster";
    }
  } catch {
    /* cross-origin parent access throws; ignore */
  }

  return "web";
}
