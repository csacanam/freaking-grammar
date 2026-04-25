"use client";

import Image from "next/image";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { pickPalette } from "@/lib/palette";
import {
  startRun,
  submitAnswer,
  finishRun,
  type RunQuestion,
} from "@/lib/api";
import { useCurrentPlayer } from "@/lib/wallet";
import { useLang } from "@/lib/lang-provider";
import { posthog } from "@/lib/posthog-provider";

const QUESTION_SECONDS = 5;

type Outcome = "playing" | "correct" | "wrong" | "timeout" | "loading";

export default function GamePage() {
  return (
    <Suspense fallback={null}>
      <GameInner />
    </Suspense>
  );
}

function GameInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const txHash = sp.get("tx") || "";
  const { address } = useCurrentPlayer();
  const { t, game } = useLang();
  const [runId, setRunId] = useState<string | null>(null);
  const [score, setScore] = useState(0);
  const [qIndex, setQIndex] = useState(0);
  const [question, setQuestion] = useState<RunQuestion | null>(null);
  const [palette, setPalette] = useState(() => pickPalette(0));
  const [leftIsCorrect, setLeftIsCorrect] = useState(true);
  const [secondsLeft, setSecondsLeft] = useState(QUESTION_SECONDS);
  const [outcome, setOutcome] = useState<Outcome>("loading");
  // Two-phase pre-game: (1) briefing overlay with rules + explicit "I'm ready"
  // tap — gives first-timers time to read the 5s-per-question rule without
  // the urgency of a countdown. (2) short 3-2-1-GO for tension after the tap.
  const [readyCount, setReadyCount] = useState<number | null>(3);
  const [readyStarted, setReadyStarted] = useState(false);

  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const transitionRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Prevents double-invoke of startRun when the pre-game effect re-runs (HMR,
  // StrictMode, dep reference changes). The server is idempotent anyway but
  // guarding here avoids the needless second round-trip.
  const startingRef = useRef(false);
  const [startError, setStartError] = useState<string | null>(null);

  // Safety guard: /game requires a connected wallet AND a tx hash in the URL
  // (every play is backed by an on-chain play() call). Deep-linked without
  // those → bounce home.
  useEffect(() => {
    if (!address || !txHash) router.replace(`/?game=${game}`);
  }, [address, txHash, game, router]);

  // Countdown 3 → 2 → 1 → GO! → startRun (~3s). Gated behind readyStarted so
  // it doesn't auto-run while the briefing is still on screen.
  useEffect(() => {
    if (readyCount === null) return;
    if (!readyStarted) return;
    if (readyCount === 0) {
      const id = setTimeout(async () => {
        if (startingRef.current) return;
        startingRef.current = true;
        try {
          if (!address || !txHash) throw new Error("no-address-or-tx");
          const res = await startRun(game, address, txHash);
          setRunId(res.runId);
          setQuestion(res.question);
          setLeftIsCorrect(Math.random() < 0.5);
          setPalette(pickPalette(0));
          setSecondsLeft(QUESTION_SECONDS);
          setOutcome("playing");
          setReadyCount(null);
          posthog.capture("play_started", { game, run_id: res.runId });
        } catch (e) {
          // Don't yeet the user back home on server errors — they paid for
          // this turn. Surface the error and let them retry from the
          // briefing, which reuses the same txHash (server is idempotent).
          console.error("startRun failed:", e);
          startingRef.current = false;
          setStartError((e as Error)?.message ?? "Could not start the run.");
        }
      }, 500);
      return () => clearTimeout(id);
    }
    const id = setTimeout(
      () => setReadyCount((c) => (c === null ? null : c - 1)),
      1000,
    );
    return () => clearTimeout(id);
  }, [readyCount, readyStarted, router, address, txHash, game]);

  // Every run's first question has no timer — players get a moment to
  // read the mechanic + the phrase before the 5s clock kicks in on Q2.
  // Same rule for everyone, every play, so the minimum score is
  // reliably 1 across the board and there's no edge-case stress on
  // the very first tap.
  const noTimerThisQuestion = qIndex === 0;
  useEffect(() => {
    if (outcome !== "playing") return;
    if (noTimerThisQuestion) return;
    tickRef.current = setInterval(() => {
      setSecondsLeft((s) =>
        s <= 0.05 ? 0 : Math.max(0, +(s - 0.1).toFixed(2)),
      );
    }, 100);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [outcome, qIndex, noTimerThisQuestion]);

  // timeout → finish run on the server, navigate to over
  useEffect(() => {
    if (outcome !== "playing" || secondsLeft > 0 || !runId) return;
    setOutcome("timeout");
    (async () => {
      try {
        const res = await finishRun(runId, "timeout");
        posthog.capture("play_finished", {
          game,
          run_id: runId,
          score: res.score,
          rank: res.rank,
          reason: "timeout",
        });
        transitionRef.current = setTimeout(() => {
          router.replace(
            `/game/over?score=${res.score}&rank=${res.rank}&reason=timeout&game=${game}`,
          );
        }, 700);
      } catch {
        router.replace(`/game/over?score=${score}&reason=timeout&game=${game}`);
      }
    })();
    return () => {
      if (transitionRef.current) clearTimeout(transitionRef.current);
    };
  }, [secondsLeft, outcome, runId, score, router]);

  const onPick = useCallback(
    async (side: "left" | "right") => {
      if (outcome !== "playing" || !question || !runId) return;
      const pickedCorrect = (side === "left") === leftIsCorrect;
      const pickedWord = pickedCorrect ? question.correct : question.wrong;
      setOutcome(pickedCorrect ? "correct" : "wrong");

      const minShow = pickedCorrect ? 350 : 700;
      const minDelay = new Promise<void>((r) => setTimeout(r, minShow));

      try {
        const [res] = await Promise.all([submitAnswer(runId, pickedWord), minDelay]);
        if ("ended" in res && res.ended) {
          posthog.capture("play_finished", {
            game,
            run_id: runId,
            score: res.score,
            rank: res.rank,
            reason: res.reason,
          });
          router.replace(
            `/game/over?score=${res.score}&rank=${res.rank}&reason=${res.reason}&game=${game}`,
          );
        } else if (res.correct && "nextQuestion" in res) {
          setQuestion(res.nextQuestion);
          setScore(res.score);
          setLeftIsCorrect(Math.random() < 0.5);
          setPalette(pickPalette(qIndex + 1));
          setQIndex((i) => i + 1);
          setSecondsLeft(QUESTION_SECONDS);
          setOutcome("playing");
        }
      } catch {
        await minDelay;
        router.replace(
          `/game/over?score=${score}&reason=${pickedCorrect ? "cleared" : "wrong"}&game=${game}`,
        );
      }
    },
    [outcome, question, runId, leftIsCorrect, score, qIndex, router],
  );

  const left = useMemo(
    () => (question ? (leftIsCorrect ? question.correct : question.wrong) : ""),
    [question, leftIsCorrect],
  );
  const right = useMemo(
    () => (question ? (leftIsCorrect ? question.wrong : question.correct) : ""),
    [question, leftIsCorrect],
  );

  const phraseParts = (question?.phrase ?? "").split("____");

  const pickedLeft =
    (outcome === "correct" && leftIsCorrect) ||
    (outcome === "wrong" && !leftIsCorrect);
  const pickedRight =
    (outcome === "correct" && !leftIsCorrect) ||
    (outcome === "wrong" && leftIsCorrect);

  const sideStyle = (isPicked: boolean, isIdle: boolean) => {
    if (isPicked) return "ring-[10px] ring-inset ring-white scale-[1.03] z-[1]";
    if (!isIdle) return "opacity-30 scale-[0.98]";
    return "";
  };
  const leftStyle = sideStyle(pickedLeft, !pickedLeft && !pickedRight && outcome === "playing");
  const rightStyle = sideStyle(pickedRight, !pickedLeft && !pickedRight && outcome === "playing");
  const canTap = outcome === "playing";

  if (startError) {
    return (
      <StartErrorOverlay
        message={startError}
        onRetry={() => {
          setStartError(null);
          setReadyStarted(false);
          setReadyCount(3);
        }}
      />
    );
  }

  if (readyCount !== null) {
    return !readyStarted ? (
      <BriefingOverlay onReady={() => setReadyStarted(true)} />
    ) : (
      <ReadyOverlay count={readyCount} />
    );
  }

  if (!question) {
    return (
      <div className="flex-1 flex items-center justify-center bg-teal text-white font-display text-xl">
        …
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-row select-none touch-manipulation overflow-hidden relative">
      <button
        onClick={() => onPick("left")}
        disabled={!canTap}
        className={`flex-1 ${palette.left} transition-all duration-150 ${canTap ? "active:brightness-110" : "cursor-default"} ${leftStyle}`}
        aria-label={left}
      />
      <button
        onClick={() => onPick("right")}
        disabled={!canTap}
        className={`flex-1 ${palette.right} transition-all duration-150 ${canTap ? "active:brightness-110" : "cursor-default"} ${rightStyle}`}
        aria-label={right}
      />

      <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex items-center justify-between px-5 pointer-events-none z-[5]">
        <span className="font-display text-white text-[clamp(1.5rem,9vw,2.75rem)] leading-none text-right max-w-[38%] break-words drop-shadow-sm">
          {left}
        </span>
        <span className="font-display text-white text-[clamp(1.5rem,9vw,2.75rem)] leading-none text-left max-w-[38%] break-words drop-shadow-sm">
          {right}
        </span>
      </div>

      <div
        className="absolute left-4 right-4 flex items-start justify-between pointer-events-none z-20"
        style={{ top: "max(1rem, env(safe-area-inset-top))" }}
      >
        <div className="bg-white rounded-full w-16 h-16 flex flex-col items-center justify-center shadow-md">
          <span className="font-display text-[10px] tracking-widest uppercase text-muted">
            {t.score}
          </span>
          <span className="font-display text-2xl text-ink leading-none">
            {score}
          </span>
        </div>
        {noTimerThisQuestion ? <TutorialBadge label={t.firstPlayBadge} /> : <Timer secondsLeft={secondsLeft} />}
      </div>

      <div className="absolute inset-x-4 top-[23%] z-10 pointer-events-none">
        <div className="bg-white rounded-2xl shadow-[0_6px_0_0_rgba(0,0,0,0.10)] overflow-hidden">
          {/* Time-left bar glued to the top of the phrase card. Traffic-
              light progression: teal (go) → yellow (yield) → red + pulse
              (stop). Yellow kicks in at the half-way mark so the color
              shift reads clearly — teal alone on the left edge of the
              card echoes the teal screen-half behind it and the drain
              becomes easy to miss. Hidden on the tutorial Q1 — there's
              no clock to show, and the static bar would be misleading. */}
          <div className="h-1 bg-black/5">
            {!noTimerThisQuestion && (
              <div
                className={`h-full transition-[width,background-color] duration-100 ease-linear ${
                  secondsLeft < 1
                    ? "bg-red animate-pulse"
                    : secondsLeft < 2.5
                    ? "bg-yellow"
                    : "bg-teal"
                }`}
                style={{
                  width: `${Math.max(
                    0,
                    Math.min(100, (secondsLeft / QUESTION_SECONDS) * 100),
                  )}%`,
                }}
              />
            )}
          </div>
          <p className="font-display text-[clamp(1.1rem,5.5vw,1.6rem)] leading-tight text-ink text-center break-words px-5 py-5">
            {phraseParts.map((part, i) => (
              <span key={i}>
                {part}
                {i < phraseParts.length - 1 && (
                  <span
                    aria-label="blank"
                    className="inline-block align-baseline mx-1 w-[3em] h-0 border-b-[3px] border-ink/70"
                  />
                )}
              </span>
            ))}
          </p>
        </div>
        {noTimerThisQuestion && (
          <p className="text-center text-white/90 text-xs font-display tracking-widest uppercase mt-3 drop-shadow-sm">
            {t.firstPlayHint}
          </p>
        )}
      </div>

      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 pointer-events-none">
        <div className="w-20 h-20 rounded-full bg-white shadow-lg flex items-center justify-center">
          <Image src="/mascot.png" alt="" width={56} height={56} />
        </div>
      </div>
    </div>
  );
}

// Shown when startRun fails (network hiccup, server error, stale tx). The
// player already paid, so we must never silently drop them back home — give
// them a retry that re-sends the same txHash (idempotent on the server).
function StartErrorOverlay({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-6 bg-teal text-white px-6 text-center">
      <Image src="/mascot.png" alt="" width={96} height={96} />
      <h1 className="font-display text-4xl leading-tight">
        Couldn&rsquo;t start the run
      </h1>
      <p className="font-mono text-sm opacity-80 max-w-xs break-words">
        {message}
      </p>
      <button
        onClick={onRetry}
        className="bg-yellow text-ink font-display text-xl tracking-widest uppercase px-8 py-3 rounded-2xl shadow-[0_5px_0_0_rgba(0,0,0,0.18)] active:translate-y-[3px] active:shadow-[0_2px_0_0_rgba(0,0,0,0.18)]"
      >
        Try again
      </button>
      <p className="text-xs opacity-60 max-w-[18rem]">
        Your payment is safe — the same tx is reused on retry.
      </p>
    </div>
  );
}

// Phase 1 — briefing. Rules paced at the user's speed; no automatic ticking
// so first-timers can actually read the 5s-per-question rule before the run.
function BriefingOverlay({ onReady }: { onReady: () => void }) {
  const { t } = useLang();
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-6 bg-teal text-white px-6 text-center">
      <Image src="/mascot.png" alt="" width={112} height={112} priority />
      <h1 className="font-display text-5xl leading-tight">{t.tapCorrect}</h1>
      <div className="flex flex-col gap-3 font-display text-3xl leading-tight">
        <p>{t.rulesTime}</p>
        <p>{t.rulesMiss}</p>
      </div>
      <button
        onClick={onReady}
        className="mt-2 bg-yellow text-ink font-display text-2xl tracking-widest uppercase px-10 py-4 rounded-2xl shadow-[0_6px_0_0_rgba(0,0,0,0.18)] active:translate-y-[3px] active:shadow-[0_3px_0_0_rgba(0,0,0,0.18)] transition"
      >
        {t.imReady}
      </button>
    </div>
  );
}

// Phase 2 — tension. Short 3-2-1-GO after the explicit tap. No new info here;
// the rules were already internalized in the briefing.
function ReadyOverlay({ count }: { count: number }) {
  const { t } = useLang();
  const isGo = count === 0;
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-10 bg-teal text-white px-6 text-center">
      <h1 className="font-display text-4xl leading-tight opacity-90">
        {t.tapCorrect}
      </h1>
      <div
        key={count}
        className={`font-display leading-none ${
          isGo ? "text-yellow text-8xl" : "text-white text-[9rem]"
        } animate-[pop_650ms_ease-out]`}
      >
        {isGo ? t.go : count}
      </div>
      <style>{`
        @keyframes pop {
          0%   { transform: scale(0.5); opacity: 0; }
          35%  { transform: scale(1.15); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

// Replaces the circular Timer on the tutorial Q1 so there's no ticking
// number — users see a calm "tutorial" pill instead of a clock that
// isn't running, which would feel broken.
function TutorialBadge({ label }: { label: string }) {
  return (
    <div className="relative w-16 h-16 flex items-center justify-center">
      <div
        aria-hidden
        className="absolute inset-0 rounded-full border-2 border-white/70"
      />
      <span className="relative font-display text-[10px] tracking-widest uppercase text-white text-center leading-tight px-2">
        {label}
      </span>
    </div>
  );
}

function Timer({ secondsLeft }: { secondsLeft: number }) {
  const ratio = Math.max(0, Math.min(1, secondsLeft / QUESTION_SECONDS));
  const stroke = 4;
  const r = 26;
  const c = 2 * Math.PI * r;
  const dash = c * ratio;
  const danger = secondsLeft < 1.5;
  return (
    <div className="relative w-16 h-16 flex items-center justify-center">
      <svg width="64" height="64" viewBox="0 0 64 64" className="absolute inset-0">
        <circle
          cx="32"
          cy="32"
          r={r}
          stroke="rgba(255,255,255,0.5)"
          strokeWidth={stroke}
          fill="none"
        />
        <circle
          cx="32"
          cy="32"
          r={r}
          stroke={danger ? "#e74c3c" : "white"}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${dash} ${c}`}
          strokeLinecap="round"
          transform="rotate(-90 32 32)"
          style={{ transition: "stroke-dasharray 100ms linear, stroke 200ms" }}
        />
      </svg>
      <span
        className={`relative font-display text-2xl ${
          danger ? "text-red" : "text-white"
        }`}
      >
        {Math.ceil(secondsLeft)}
      </span>
    </div>
  );
}
