"use client";

import Image from "next/image";
import Link from "next/link";
import { useLang } from "@/lib/lang-provider";

// nerdos.fun platform picker. The bare domain lands here so visitors see
// the platform-level identity first; clicking into a game drops them
// into the game's own home (`/grammar`, `/math`, …) where the existing
// in-game UX takes over. BottomTabs is hidden on this route — that nav
// is scoped to in-game pages.
export default function PickerHome() {
  const { t } = useLang();

  return (
    <div className="flex-1 flex flex-col max-w-md mx-auto w-full px-5 pt-8 pb-16">
      <header className="flex flex-col items-center gap-4 mb-8">
        <Image
          src="/mascot.png"
          alt=""
          width={88}
          height={88}
          priority
        />
        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="font-display text-3xl tracking-wider">nerdos.fun</h1>
          <p className="font-display text-sm tracking-[0.2em] uppercase text-muted">
            {t.nerdosTagline}
          </p>
        </div>
      </header>

      <div className="font-display text-xs tracking-[0.25em] uppercase text-muted mb-3 px-1">
        {t.nerdosPickAGame}
      </div>

      <div className="flex flex-col gap-3">
        <GameCard
          href="/grammar"
          emoji="🔤"
          title={t.grammarCardTitle}
          blurb={t.grammarCardBlurb}
          status="live"
          statusLabel={t.cardLive}
        />
        <GameCard
          href={null}
          emoji="🔢"
          title={t.mathCardTitle}
          blurb={t.mathCardBlurb}
          status="soon"
          statusLabel={t.cardSoon}
        />
      </div>

      <Link
        href="/grammar/stats"
        className="self-center mt-8 inline-flex items-center gap-1.5 text-xs font-display tracking-[0.25em] uppercase text-muted hover:text-ink"
      >
        <span aria-hidden>📊</span>
        {t.statsLinkLabel}
      </Link>
    </div>
  );
}

function GameCard({
  href,
  emoji,
  title,
  blurb,
  status,
  statusLabel,
}: {
  href: string | null;
  emoji: string;
  title: string;
  blurb: string;
  status: "live" | "soon";
  statusLabel: string;
}) {
  const inner = (
    <div
      className={`relative rounded-3xl px-5 py-5 border transition-shadow ${
        status === "live"
          ? "bg-white border-black/10 shadow-[0_4px_0_0_rgba(0,0,0,0.06)] active:translate-y-[2px] active:shadow-[0_2px_0_0_rgba(0,0,0,0.06)]"
          : "bg-black/5 border-black/5 opacity-60"
      }`}
    >
      <div className="flex items-start gap-4">
        <div className="text-4xl shrink-0 leading-none mt-0.5">{emoji}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="font-display text-xl tracking-wide leading-tight truncate">
              {title}
            </h2>
            <span
              className={`text-[10px] font-display tracking-[0.2em] uppercase px-2 py-0.5 rounded-full shrink-0 ${
                status === "live"
                  ? "bg-teal text-white"
                  : "bg-black/10 text-muted"
              }`}
            >
              {statusLabel}
            </span>
          </div>
          <p className="text-sm text-muted mt-1 leading-snug">{blurb}</p>
        </div>
        {status === "live" && (
          <span
            className="self-center text-2xl text-muted shrink-0"
            aria-hidden
          >
            →
          </span>
        )}
      </div>
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="block">
        {inner}
      </Link>
    );
  }
  return <div aria-disabled>{inner}</div>;
}
