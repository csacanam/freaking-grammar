import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "@/lib/providers";
import { BottomTabs } from "@/components/BottomTabs";

// Strip any trailing slash so `${SITE_URL}/foo` never produces a `//`.
// The Warpcast manifest validator rejects URLs with double slashes and
// it's the kind of bug a stray env-var edit can introduce silently.
const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || "https://freaking-grammar.vercel.app"
).replace(/\/+$/, "");

// Farcaster mini-app preview embedded when the URL is shared in Warpcast /
// Base App. `fc:miniapp` is the current spec; `fc:frame` (with the same
// payload but `launch_frame` action type) is included for backwards
// compatibility with older clients that haven't migrated yet.
const fcMiniAppEmbed = {
  version: "1",
  imageUrl: `${SITE_URL}/opengraph-image`,
  button: {
    title: "Play",
    action: {
      type: "launch_miniapp",
      url: SITE_URL,
      name: "nerdos.fun",
      splashImageUrl: `${SITE_URL}/splash-200.png`,
      splashBackgroundColor: "#68c3a0",
    },
  },
};
const fcFrameEmbed = {
  ...fcMiniAppEmbed,
  button: {
    ...fcMiniAppEmbed.button,
    action: {
      ...fcMiniAppEmbed.button.action,
      type: "launch_frame",
    },
  },
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "nerdos.fun",
  description: "Daily games for nerdos. Rewards for curious minds.",
  openGraph: {
    title: "nerdos.fun",
    description: "Daily games for nerdos. Rewards for curious minds.",
    url: SITE_URL,
    siteName: "nerdos.fun",
    images: [{ url: "/opengraph-image", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "nerdos.fun",
    description: "Daily games for nerdos. Rewards for curious minds.",
    images: ["/opengraph-image"],
  },
  other: {
    "fc:miniapp": JSON.stringify(fcMiniAppEmbed),
    "fc:frame": JSON.stringify(fcFrameEmbed),
    "talentapp:project_verification":
      "0271c229cfedd27cd3ece2158b4c3f2621fc40db9e69013c953ff77b15bef408596abe4461d369454648c4110fc64be149b5f4cca98b89126a2fb56d5193864e",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#68c3a0",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full antialiased">
      <head>
        {/* Preconnect hints for the third-party origins the wallet stack
            and analytics hit on first paint. Resolves DNS + TLS in
            parallel with the main HTML so the actual fetches don't pay
            handshake latency. Origins picked from
            docs/minipay-origin-manifest.md — only the ones that fire
            during initial load, not the lazy WalletConnect / Reown ones
            that wait for a user click. */}
        <link rel="preconnect" href="https://auth.privy.io" crossOrigin="" />
        <link rel="preconnect" href="https://us.i.posthog.com" crossOrigin="" />
        <link
          rel="preconnect"
          href="https://us-assets.i.posthog.com"
          crossOrigin=""
        />
        <link
          rel="preconnect"
          href="https://challenges.cloudflare.com"
          crossOrigin=""
        />
        <link rel="dns-prefetch" href="https://forno.celo.org" />
        <link rel="dns-prefetch" href="https://celo-mainnet.g.alchemy.com" />
      </head>
      <body className="min-h-dvh flex flex-col bg-bg text-ink">
        <Providers>
          <main className="flex-1 flex flex-col pb-20">{children}</main>
          <BottomTabs />
        </Providers>
      </body>
    </html>
  );
}
