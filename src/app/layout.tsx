import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "@/lib/providers";
import { BottomTabs } from "@/components/BottomTabs";

export const metadata: Metadata = {
  title: "Freaking Grammar",
  description: "Test your grammar agility. Daily pot, winner takes all.",
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
