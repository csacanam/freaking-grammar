import type { NextConfig } from "next";

// Content Security Policy assembled from Privy's required directives
// (https://docs.privy.io/security/implementation-guide/content-security-policy)
// plus everything else the app actually talks to from the browser.
//
// Intentionally shipped as Report-Only first so a missed origin doesn't
// take down login or wallet connect in production — once we have a few
// days with no violation reports in the console we'll flip the header
// name to the enforcing variant.
//
// 'unsafe-inline' on script-src is currently required by Next.js's own
// hydration runtime and a few Wagmi/viem helpers. Locking down with
// nonces is the next step after report-only proves clean.
const csp = [
  "default-src 'self'",
  // Cloudflare CAPTCHA is loaded by Privy's auth iframe; 'unsafe-eval'
  // covers a couple of viem/wagmi paths and React strict-mode dev
  // tooling. Tight enough to block most XSS, loose enough not to
  // surprise the integration in prod.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  // Privy hosts its login UX in an iframe at auth.privy.io; WalletConnect
  // verifies wallet origins through verify.walletconnect.{com,org}.
  "frame-src 'self' https://auth.privy.io https://verify.walletconnect.com https://verify.walletconnect.org",
  // Allow Warpcast and Farcaster to embed nerdos.fun (this app IS a
  // Farcaster mini-app; locking frame-ancestors to 'none' kills that).
  "frame-ancestors 'self' https://warpcast.com https://*.warpcast.com https://farcaster.xyz https://*.farcaster.xyz",
  [
    "connect-src 'self'",
    // Privy
    "https://auth.privy.io",
    "https://*.rpc.privy.systems",
    // Privy custom domain — when HttpOnly cookies is enabled in the
    // Privy dashboard, requests are routed via privy.nerdos.fun
    // (CNAME to Privy's infra) instead of auth.privy.io. 'self'
    // doesn't cover subdomains, so it has to be listed explicitly.
    "https://privy.nerdos.fun",
    // Alchemy — Privy's embedded wallet + wagmi's default ETH client
    // hit Alchemy for ENS resolution and L1 reads even though our
    // primary chain is Celo. The wildcard covers their per-network
    // subdomains (eth-mainnet, base-mainnet, etc.).
    "https://*.g.alchemy.com",
    // WalletConnect / Coinbase Wallet
    "https://explorer-api.walletconnect.com",
    "wss://relay.walletconnect.com",
    "wss://relay.walletconnect.org",
    "wss://www.walletlink.org",
    // PostHog (events posted from the browser SDK)
    "https://us.i.posthog.com",
    "https://us.posthog.com",
    // Celo RPC + block explorer used directly from the client
    "https://forno.celo.org",
    "https://ethereum-rpc.publicnode.com",
    "https://celo.blockscout.com",
  ].join(" "),
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  // Report violations to the console without enforcing — flip the
  // header name to "Content-Security-Policy" once we've confirmed a
  // clean run with real users on prod.
  { key: "Content-Security-Policy-Report-Only", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // We don't ask for any of these in the app; locking them down stops
  // a future XSS from prompting the user for the camera/mic/etc.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
  // Vercel sets HSTS by default, but making it explicit pins it across
  // hosts and survives a future migration off Vercel.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  // Backward-compat for the days when Freaking Grammar lived at the root
  // (no /grammar prefix). Anyone with a bookmarked /game?tx=... or
  // /history?game=es link still lands inside the game. Permanent so
  // search engines + Farcaster's preview cache update too. The bare /
  // is intentionally not redirected — that route now serves the
  // platform picker.
  //
  // Stats moved the other way: it used to live at /grammar/stats but
  // covers all games now (Grammar EN/ES + Math), so it's promoted to
  // /stats. The /grammar/stats redirect catches anyone who bookmarked
  // the old path.
  async redirects() {
    return [
      { source: "/game", destination: "/grammar/game", permanent: true },
      {
        source: "/game/:path*",
        destination: "/grammar/game/:path*",
        permanent: true,
      },
      { source: "/history", destination: "/grammar/history", permanent: true },
      { source: "/grammar/stats", destination: "/stats", permanent: true },
    ];
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
