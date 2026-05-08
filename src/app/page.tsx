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
          {/* Brand name + tagline use the system sans, NOT font-display.
              The display font (Bebas Neue) is uppercase-only by design,
              so anything routed through it renders as NERDOS.FUN —
              wrong for a lowercase domain identity. Section labels and
              stage chrome stay on font-display where caps read fine. */}
          <h1 className="text-4xl font-bold tracking-tight">nerdos.fun</h1>
          {/* Tagline displays as two stacked lines on the picker so the
              "who" and the "why" each get their own beat. Source string
              stays one line (used as-is for meta tags / OG / Farcaster
              description); we just inject a newline after the first
              sentence and let `whitespace-pre-line` honour it here. */}
          <p className="text-base text-muted whitespace-pre-line leading-snug">
            {t.nerdosTagline.replace(". ", ".\n")}
          </p>
        </div>
      </header>

      <div className="font-display text-base tracking-[0.2em] uppercase text-muted mb-3 px-1">
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
          href="/math"
          emoji="🔢"
          title={t.mathCardTitle}
          blurb={t.mathCardBlurb}
          status="live"
          statusLabel={t.cardLive}
        />
      </div>

      <Link
        href="/stats"
        className="self-center mt-8 inline-flex items-center gap-2 text-base font-display tracking-[0.2em] uppercase text-muted hover:text-ink"
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
      {/* Status badge sits absolute top-right so its position is constant
          regardless of the title length — inline next to the title looked
          ragged because the offset moved with each game's name. */}
      <span
        className={`absolute top-3 right-3 text-[10px] font-display tracking-[0.2em] uppercase px-2 py-0.5 rounded-full ${
          status === "live"
            ? "bg-teal text-white"
            : "bg-black/10 text-muted"
        }`}
      >
        {statusLabel}
      </span>
      <div className="flex items-start gap-4 pr-12">
        <div className="text-4xl shrink-0 leading-none mt-0.5">{emoji}</div>
        <div className="flex-1 min-w-0">
          <h2 className="font-display text-2xl tracking-wide leading-tight">
            {title}
          </h2>
          <p className="text-base text-muted mt-2 leading-snug">{blurb}</p>
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
