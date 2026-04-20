import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "@/lib/providers";
import { BottomTabs } from "@/components/BottomTabs";

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL || "https://freaking-grammar.vercel.app";

// Farcaster mini-app preview embedded when the URL is shared in Warpcast /
// Base App. `fc:miniapp` is Farcaster's share-card protocol — the image
// shown is our dynamic OG image (see opengraph-image.tsx).
const fcMiniApp = {
  version: "1",
  imageUrl: `${SITE_URL}/opengraph-image`,
  button: {
    title: "Play",
    action: {
      type: "launch_frame",
      url: SITE_URL,
      name: "Freaking Grammar",
      splashImageUrl: `${SITE_URL}/mascot.png`,
      splashBackgroundColor: "#68c3a0",
    },
  },
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Freaking Grammar",
  description:
    "Daily grammar pot. Tap the right word fastest. Winner takes 100%.",
  openGraph: {
    title: "Freaking Grammar",
    description: "Daily grammar pot · one winner per game",
    url: SITE_URL,
    siteName: "Freaking Grammar",
    images: [{ url: "/opengraph-image", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Freaking Grammar",
    description: "Daily grammar pot · one winner per game",
    images: ["/opengraph-image"],
  },
  other: {
    "fc:miniapp": JSON.stringify(fcMiniApp),
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
      <body className="min-h-dvh flex flex-col bg-bg text-ink">
        <Providers>
          <main className="flex-1 flex flex-col pb-20">{children}</main>
          <BottomTabs />
        </Providers>
      </body>
    </html>
  );
}
