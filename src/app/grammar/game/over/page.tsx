"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import { ButtonLink } from "@/components/Button";
import { PayAndPlayButton } from "@/components/PayAndPlayButton";
import { useLang } from "@/lib/lang-provider";
import { gameIdFor } from "@/lib/i18n";
import {
  MAX_TICKETS_PER_RUN,
  ticketStepFor,
  ticketsForScore,
} from "@/lib/draw-config";

export default function GameOverPage() {
  return (
    <Suspense>
      <GameOverInner />
    </Suspense>
  );
}

function GameOverInner() {
  const { t, game } = useLang();
  const sp = useSearchParams();
  const score = Number(sp.get("score") || 0);
  const rankParam = sp.get("rank");
  const rank = rankParam ? Number(rankParam) : null;
  const reason = sp.get("reason") || "wrong";
  const phrase = sp.get("q");
  const correctWord = sp.get("a");
  const pickedWord = sp.get("p");

  const headline =
    reason === "timeout"
      ? t.timeUpHeadline
      : reason === "cleared"
      ? t.clearedHeadline
      : t.gameOverHeadline;

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 max-w-md mx-auto w-full text-center gap-6">
      <Image src="/mascot.png" alt="" width={96} height={96} />
      <div className="font-display text-3xl tracking-wider">{headline}</div>

      {phrase && correctWord && (
        <AnswerReveal
          phrase={phrase}
          correctWord={correctWord}
          pickedWord={pickedWord}
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
        <TicketLine paid={sp.get("paid") === "1"} score={score} />
      </div>

      <div className="w-full flex flex-col gap-3">
        <PayAndPlayButton playerHasFreePlay={false} replay />
        <ButtonLink href={`/grammar?game=${game}`} variant="ghost" full>
          ← {t.backToLobby}
        </ButtonLink>
      </div>
    </div>
  );
}

// Ticket feedback under the score — rank is glory, tickets are the prize
// path, and this is where the player learns the difference. Paid run: how
// many tickets it holds + how far the next one was. Free run: the nudge that
// the draw is where paid plays go. `paid` comes via URL param from the game
// page (older responses without the flag render nothing — never a wrong
// claim).
function TicketLine({ paid, score }: { paid: boolean; score: number }) {
  const { t, game } = useLang();
  if (!paid) {
    return (
      <div className="text-xs text-muted mt-4 border-t border-black/5 pt-3 leading-snug">
        🎟 {t.gameOverFreeNudge}
      </div>
    );
  }
  const gameId = gameIdFor(game);
  const tickets = ticketsForScore(score, gameId);
  const line =
    tickets === 1
      ? t.gameOverTicketOne
      : t.gameOverTicketsMany.replace("{k}", String(tickets));
  return (
    <div className="text-xs text-ink mt-4 border-t border-black/5 pt-3 leading-snug">
      <span className="font-semibold">🎟 {line}</span>
      {tickets < MAX_TICKETS_PER_RUN && (
        <div className="text-muted mt-1">
          {t.gameOverNextTicket.replace(
            "{n}",
            String(tickets * ticketStepFor(gameId)),
          )}
        </div>
      )}
    </div>
  );
}

// Shows the question the run died on with the blank filled in. With only two
// options on screen, "you were wrong" already implies which word was right, so
// spelling it out leaks nothing — but players misremember which side they
// tapped under the 5s clock and conclude the question bank is broken. The
// "you tapped" line is the part that actually settles it.
function AnswerReveal({
  phrase,
  correctWord,
  pickedWord,
}: {
  phrase: string;
  correctWord: string;
  pickedWord: string | null;
}) {
  const { t } = useLang();
  // Same "____" blank marker the game screen splits on.
  const parts = phrase.split("____");
  const wasWrongPick = !!pickedWord && pickedWord !== correctWord;

  return (
    <div className="rounded-3xl bg-white border border-black/5 px-6 py-5 w-full shadow-[0_6px_0_0_rgba(0,0,0,0.06)] flex flex-col gap-3">
      <div className="text-[10px] font-display tracking-widest uppercase text-muted">
        {t.revealCorrectLabel}
      </div>

      {/* The filled blank is a highlighter, not coloured text: teal on white
          is ~2:1, well under AA. Ink on a teal wash keeps it readable. */}
      <p className="font-display text-lg leading-snug text-ink break-words">
        {parts.map((part, i) => (
          <span key={i}>
            {part}
            {i < parts.length - 1 && (
              <span className="bg-teal/30 rounded-md px-1.5 py-0.5 text-ink">
                {correctWord}
              </span>
            )}
          </span>
        ))}
      </p>

      <div className="text-xs text-muted border-t border-black/5 pt-3">
        {wasWrongPick ? (
          <>
            {t.revealPickedLabel}{" "}
            <span className="font-display text-red line-through">
              {pickedWord}
            </span>
          </>
        ) : (
          t.revealNoPick
        )}
      </div>
    </div>
  );
}
