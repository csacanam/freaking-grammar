"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import { ButtonLink } from "@/components/Button";
import { PayAndPlayButton } from "@/components/PayAndPlayButton";
import { useLang } from "@/lib/lang-provider";
import { opGlyph } from "@/lib/math-display";

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
  const headline = reason === "timeout" ? t.timeUpHeadline : t.gameOverHeadline;

  const left = sp.get("l");
  const trueResult = sp.get("tr");

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 max-w-md mx-auto w-full text-center gap-6">
      <Image src="/mascot.png" alt="" width={96} height={96} />
      <div className="font-display text-3xl tracking-wider">{headline}</div>

      {left && trueResult && (
        <MathAnswerReveal
          left={left}
          right={sp.get("r") ?? ""}
          op={sp.get("o") ?? "+"}
          shown={sp.get("s") ?? ""}
          trueResult={trueResult}
          pickedChoice={sp.get("pc")}
        />
      )}

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

// Shows the equation the run died on with the real result. Grammar's reveal
// fills the blank; here the equivalent is striking the on-screen result when
// it was a decoy and highlighting the true one. Same reasoning applies: with a
// binary ✓/✗ the verdict was already implied, but players misremember which
// button they hit at 1.5s and conclude the maths is broken.
function MathAnswerReveal({
  left,
  right,
  op,
  shown,
  trueResult,
  pickedChoice,
}: {
  left: string;
  right: string;
  op: string;
  shown: string;
  trueResult: string;
  pickedChoice: string | null;
}) {
  const { t } = useLang();
  // The equation was honest when what was displayed matched the real result;
  // then there's nothing to strike, just the result to confirm.
  const wasDecoy = shown !== trueResult;

  return (
    <div className="rounded-3xl bg-white border border-black/5 px-6 py-5 w-full shadow-[0_6px_0_0_rgba(0,0,0,0.06)] flex flex-col gap-3">
      <div className="text-[10px] font-display tracking-widest uppercase text-muted">
        {t.revealCorrectLabel}
      </div>

      <p className="font-display text-2xl leading-snug text-ink flex items-center justify-center gap-2 flex-wrap">
        <span>
          {left} {opGlyph(op)} {right} =
        </span>
        {wasDecoy && (
          <span className="text-red line-through opacity-70">{shown}</span>
        )}
        {/* Highlighter rather than coloured text — teal on white is ~2:1. */}
        <span className="bg-teal/30 rounded-md px-2 py-0.5 text-ink">
          {trueResult}
        </span>
      </p>

      <div className="text-xs text-muted border-t border-black/5 pt-3">
        {pickedChoice === "correct" || pickedChoice === "incorrect" ? (
          <>
            {t.revealPickedLabel}{" "}
            <span className="font-display text-red">
              {pickedChoice === "correct" ? "✓" : "✗"}
            </span>
          </>
        ) : (
          t.revealNoPick
        )}
      </div>
    </div>
  );
}
