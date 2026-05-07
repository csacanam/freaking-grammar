"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAccount } from "wagmi";
import {
  startMathRun,
  submitMathAnswer,
  finishMathRun,
  type MathQuestion,
} from "@/lib/api";
import { useLang } from "@/lib/lang-provider";
import { posthog } from "@/lib/posthog-provider";

// Mirrors the difficulty curve in src/lib/math-questions.ts so the
// client-side timer matches what the server thinks each question is
// worth. Keeping it duplicated keeps the gameplay layer entirely on
// the client (no extra round-trip per question to ask "how long?").
function timeBudgetSec(q: number): number {
  if (q < 1) return 0; // q_index 0 has no timer (briefing question)
  if (q >= 30) return 1.5;
  return Number((3.0 - ((q - 1) / 29) * 1.5).toFixed(2));
}

// Display-friendly operator glyphs. The server sends "x" / "/" because
// those are stable in JSON; we render them as proper math symbols.
function opGlyph(op: MathQuestion["op"]): string {
  switch (op) {
    case "+": return "+";
    case "-": return "−";
    case "x": return "×";
    case "/": return "÷";
  }
}

type Outcome = "playing" | "correct" | "wrong" | "timeout" | "loading";

export default function MathGamePage() {
  return (
    <Suspense fallback={null}>
      <MathGameInner />
    </Suspense>
  );
}

function MathGameInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const txHash = sp.get("tx") || "";
  // Use wagmi directly here (not useCurrentPlayer) so we can read
  // the auto-reconnect status. On a direct-nav to /math/game?tx=…
  // wagmi takes a beat to rehydrate the connector — without
  // gating on it, the bounce-home effect runs before address is
  // populated and yanks the user back to /math mid-load.
  const { address: rawAddress, isConnected, isConnecting, isReconnecting } =
    useAccount();
  const address = rawAddress ? rawAddress.toLowerCase() : "";
  // Math has no language split, but the LangProvider still gives us
  // uiLang for chrome strings (CORRECT / INCORRECT etc.).
  useLang();

  const [runId, setRunId] = useState<string | null>(null);
  const [score, setScore] = useState(0);
  const [qIndex, setQIndex] = useState(0);
  const [question, setQuestion] = useState<MathQuestion | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(3);
  const [outcome, setOutcome] = useState<Outcome>("loading");
  const [readyCount, setReadyCount] = useState<number | null>(3);
  const [readyStarted, setReadyStarted] = useState(false);
  const [picked, setPicked] = useState<"correct" | "incorrect" | null>(null);

  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const transitionRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startingRef = useRef(false);
  const [startError, setStartError] = useState<string | null>(null);

  // Bounce home if missing wallet or txHash. Wait for wagmi to finish
  // (re)connecting first — direct URL nav to /math/game?tx=… loads
  // before the wagmi connector has had a chance to populate address.
  useEffect(() => {
    if (isConnecting || isReconnecting) return;
    if (!txHash) {
      router.replace("/math");
      return;
    }
    if (!isConnected || !address) {
      router.replace("/math");
    }
  }, [address, isConnected, isConnecting, isReconnecting, txHash, router]);

  // 3-2-1-GO countdown then startMathRun.
  useEffect(() => {
    if (readyCount === null) return;
    if (!readyStarted) return;
    if (readyCount === 0) {
      const id = setTimeout(async () => {
        if (startingRef.current) return;
        startingRef.current = true;
        try {
          if (!address || !txHash) throw new Error("no-address-or-tx");
          const res = await startMathRun(address, txHash);
          setRunId(res.runId);
          setQuestion(res.question);
          setQIndex(0);
          setScore(0);
          setSecondsLeft(timeBudgetSec(0));
          setOutcome("playing");
          setReadyCount(null);
          posthog.capture("math_play_started", { run_id: res.runId });
        } catch (e) {
          console.error("startMathRun failed:", e);
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
  }, [readyCount, readyStarted, router, address, txHash]);

  // Q1 is timer-less (warm-up). Subsequent questions tick with the
  // smooth time-decay budget.
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

  // Timeout = run ends.
  useEffect(() => {
    if (outcome !== "playing" || secondsLeft > 0 || !runId) return;
    if (noTimerThisQuestion) return;
    setOutcome("timeout");
    (async () => {
      try {
        const res = await finishMathRun(runId, "timeout");
        posthog.capture("math_play_finished", {
          run_id: runId,
          score: res.score,
          rank: res.rank,
          reason: "timeout",
        });
        transitionRef.current = setTimeout(() => {
          router.replace(
            `/math/game/over?score=${res.score}&rank=${res.rank}&reason=timeout`,
          );
        }, 700);
      } catch {
        router.replace(`/math/game/over?score=${score}&reason=timeout`);
      }
    })();
    return () => {
      if (transitionRef.current) clearTimeout(transitionRef.current);
    };
  }, [secondsLeft, outcome, runId, score, router, noTimerThisQuestion]);

  const onPick = useCallback(
    async (choice: "correct" | "incorrect") => {
      if (outcome !== "playing" || !question || !runId) return;
      setPicked(choice);
      setOutcome("loading");

      try {
        const res = await submitMathAnswer(runId, choice);
        if ("ended" in res && res.ended) {
          posthog.capture("math_play_finished", {
            run_id: runId,
            score: res.score,
            rank: res.rank,
            reason: res.reason,
          });
          // Brief flash so the player sees their answer was wrong before
          // we bounce to the over screen.
          await new Promise((r) => setTimeout(r, 600));
          router.replace(
            `/math/game/over?score=${res.score}&rank=${res.rank}&reason=${res.reason}`,
          );
          return;
        }
        if (res.correct && "nextQuestion" in res) {
          // Tiny pause for "yep, that was right" feedback.
          await new Promise((r) => setTimeout(r, 250));
          setQuestion(res.nextQuestion);
          setScore(res.score);
          setQIndex((i) => i + 1);
          setSecondsLeft(timeBudgetSec(qIndex + 1));
          setPicked(null);
          setOutcome("playing");
        }
      } catch {
        router.replace(`/math/game/over?score=${score}&reason=wrong`);
      }
    },
    [outcome, question, runId, qIndex, score, router],
  );

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
      <div className="flex-1 flex items-center justify-center bg-yellow/40 font-display text-xl">
        …
      </div>
    );
  }

  const totalSeconds = timeBudgetSec(qIndex);
  const timerPct = noTimerThisQuestion
    ? 100
    : Math.min(100, (secondsLeft / Math.max(0.5, totalSeconds)) * 100);

  return (
    <div className="flex-1 flex flex-col bg-yellow/30 select-none touch-manipulation">
      {/* SCORE */}
      <div className="pt-8 pb-4 text-center">
        <div className="font-display text-xs tracking-[0.4em] text-muted">SCORE</div>
        <div className="font-display text-6xl tracking-tight tabular-nums leading-none mt-1">
          {score}
        </div>
      </div>

      {/* EQUATION */}
      <div className="flex-1 flex items-center justify-center px-6">
        <div className="font-display text-7xl tracking-tight tabular-nums text-center leading-none">
          <span className="opacity-90">{question.left}</span>
          <span className="mx-3 opacity-60">{opGlyph(question.op)}</span>
          <span className="opacity-90">{question.right}</span>
          <span className="mx-3 opacity-60">=</span>
          <span>{question.shown}</span>
        </div>
      </div>

      {/* TIMER BAR */}
      <div className="px-6 mb-5">
        <div className="h-2 bg-black/10 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-[width] duration-100 ease-linear ${
              noTimerThisQuestion
                ? "bg-teal"
                : secondsLeft < 1
                ? "bg-red"
                : secondsLeft < 1.5
                ? "bg-orange"
                : "bg-teal"
            }`}
            style={{ width: `${timerPct}%` }}
          />
        </div>
        {noTimerThisQuestion && (
          <div className="mt-2 text-center text-[10px] font-display tracking-[0.3em] uppercase text-muted">
            First one — take your time
          </div>
        )}
      </div>

      {/* BUTTONS */}
      <div className="px-5 pb-8 grid grid-cols-2 gap-3">
        <ChoiceButton
          label="CORRECT"
          glyph="✓"
          color="bg-teal"
          picked={picked === "correct"}
          dimmed={picked !== null && picked !== "correct"}
          onClick={() => onPick("correct")}
          disabled={outcome !== "playing"}
        />
        <ChoiceButton
          label="WRONG"
          glyph="✗"
          color="bg-red"
          picked={picked === "incorrect"}
          dimmed={picked !== null && picked !== "incorrect"}
          onClick={() => onPick("incorrect")}
          disabled={outcome !== "playing"}
        />
      </div>
    </div>
  );
}

function ChoiceButton({
  label,
  glyph,
  color,
  picked,
  dimmed,
  onClick,
  disabled,
}: {
  label: string;
  glyph: string;
  color: string;
  picked: boolean;
  dimmed: boolean;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${color} text-white rounded-3xl py-8 transition-all
        ${picked ? "ring-[8px] ring-inset ring-white scale-[1.02]" : ""}
        ${dimmed ? "opacity-40 scale-[0.98]" : ""}
        ${disabled && !picked && !dimmed ? "cursor-default" : "active:brightness-110"}
        shadow-[0_4px_0_0_rgba(0,0,0,0.12)]
        flex flex-col items-center justify-center gap-2`}
    >
      <span className="text-5xl leading-none">{glyph}</span>
      <span className="font-display tracking-[0.2em] text-sm">{label}</span>
    </button>
  );
}

function BriefingOverlay({ onReady }: { onReady: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-yellow/40 px-6 text-center gap-6">
      <div className="text-6xl">🔢</div>
      <h1 className="font-display text-3xl tracking-wide">Freaking Math</h1>
      <ul className="text-left text-sm space-y-2 max-w-xs text-ink/80">
        <li className="flex gap-3">
          <span aria-hidden>1.</span>
          <span>You see an equation. Decide if the result shown is right or wrong.</span>
        </li>
        <li className="flex gap-3">
          <span aria-hidden>2.</span>
          <span>5 seconds the first one, then it gets faster every question.</span>
        </li>
        <li className="flex gap-3">
          <span aria-hidden>3.</span>
          <span>One wrong answer = game over. Highest streak wins the daily pot.</span>
        </li>
      </ul>
      <button
        onClick={onReady}
        className="mt-2 bg-ink text-white rounded-full px-8 py-3 font-display tracking-[0.2em] text-sm shadow-[0_4px_0_0_rgba(0,0,0,0.18)] active:translate-y-[2px] active:shadow-[0_2px_0_0_rgba(0,0,0,0.18)]"
      >
        I&apos;M READY
      </button>
    </div>
  );
}

function ReadyOverlay({ count }: { count: number }) {
  return (
    <div className="flex-1 flex items-center justify-center bg-yellow/40">
      <div className="font-display text-9xl tracking-tight tabular-nums">
        {count > 0 ? count : "GO"}
      </div>
    </div>
  );
}

function StartErrorOverlay({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-red/20 px-6 text-center gap-4">
      <div className="text-4xl">⚠️</div>
      <p className="text-sm text-ink/80 max-w-xs">{message}</p>
      <button
        onClick={onRetry}
        className="bg-ink text-white rounded-full px-6 py-2 font-display tracking-widest text-xs"
      >
        RETRY
      </button>
    </div>
  );
}
