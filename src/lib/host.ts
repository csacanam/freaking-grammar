// Detects the runtime host so we can switch chain/payment UX without user action.
// Current targets: MiniPay (active), Farcaster + Base App (wired, deployed later).

export type Host = "minipay" | "farcaster" | "base" | "web";

export function detectHost(): Host {
  if (typeof window === "undefined") return "web";
  const eth = (window as unknown as { ethereum?: { isMiniPay?: boolean } }).ethereum;
  if (eth?.isMiniPay) return "minipay";
  // Farcaster/Base App detection lives here once the manifest is live.
  // Placeholder checks so future wiring is trivial:
  const ua = navigator.userAgent || "";
  if (/Warpcast|Farcaster/i.test(ua)) return "farcaster";
  if (/CoinbaseWallet|Base\/.+/i.test(ua)) return "base";
  return "web";
}
