"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import { ButtonLink } from "@/components/Button";
import { PayAndPlayButton } from "@/components/PayAndPlayButton";
import { useLang } from "@/lib/lang-provider";

export default function MathGameOverPage() {
  return (
    <Suspense>
      <MathGameOverInner />
    </Suspense>
  );
}

function MathGameOverInner() {
  const { t } = useLang();
  const sp = useSearchParams();
  const score = Number(sp.get("score") || 0);
  const rankParam = sp.get("rank");
  const rank = rankParam ? Number(rankParam) : null;
  const reason = sp.get("reason") || "wrong";

  // Math has only two end-states the player can land on: timeout
  // (clock ran out) and wrong (picked the bad answer). No "cleared
  // the deck" because the question generator is unbounded.
  const headline = reason === "timeout" ? t.mathTimeUp : t.mathGameOver;

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 max-w-md mx-auto w-full text-center gap-6">
      <Image src="/mascot.png" alt="" width={96} height={96} />
      <div className="font-display text-3xl tracking-wider">{headline}</div>

      <div className="rounded-3xl bg-white border border-black/5 px-10 py-8 w-full shadow-[0_6px_0_0_rgba(0,0,0,0.06)]">
        <div className="text-xs font-display tracking-widest uppercase text-muted">
          {t.yourScore}
        </div>
        <div className="font-display text-7xl leading-none text-ink mt-1">{score}</div>
        <div className="text-xs text-muted mt-3">
          {t.yourRank}: <span className="font-mono">{rank ? `#${rank}` : "—"}</span>
        </div>
      </div>

      <div className="w-full flex flex-col gap-3">
        <PayAndPlayButton playerHasFreePlay={false} replay app="math" />
        <ButtonLink href="/math" variant="ghost" full>
          ← {t.backToLobby}
        </ButtonLink>
      </div>
    </div>
  );
}
