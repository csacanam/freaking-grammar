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
  const [readyCount, setReadyCount] = useState<number | null>(5);

  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const transitionRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Safety guard: /game requires a connected wallet AND a tx hash in the URL
  // (every play is backed by an on-chain play() call). Deep-linked without
  // those → bounce home.
  useEffect(() => {
    if (!address || !txHash) router.replace(`/?game=${game}`);
  }, [address, txHash, game, router]);

  // pre-game countdown: 5 → 4 → 3 → 2 → 1 → GO! → startRun (≈5.5s total)
  useEffect(() => {
    if (readyCount === null) return;
    if (readyCount === 0) {
      const id = setTimeout(async () => {
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
        } catch {
          router.replace(`/?game=${game}`);
        }
      }, 500);
      return () => clearTimeout(id);
    }
    const id = setTimeout(
      () => setReadyCount((c) => (c === null ? null : c - 1)),
      1000,
    );
    return () => clearTimeout(id);
  }, [readyCount, router, address, txHash, game]);

  // per-question countdown
  useEffect(() => {
    if (outcome !== "playing") return;
    tickRef.current = setInterval(() => {
      setSecondsLeft((s) =>
        s <= 0.05 ? 0 : Math.max(0, +(s - 0.1).toFixed(2)),
      );
    }, 100);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [outcome, qIndex]);

  // timeout → finish run on the server, navigate to over
  useEffect(() => {
    if (outcome !== "playing" || secondsLeft > 0 || !runId) return;
    setOutcome("timeout");
    (async () => {
      try {
        const res = await finishRun(runId, "timeout");
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

  if (readyCount !== null) {
    return <ReadyOverlay count={readyCount} />;
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
        <Timer secondsLeft={secondsLeft} />
      </div>

      <div className="absolute inset-x-4 top-[23%] z-10 pointer-events-none">
        <div className="bg-white rounded-2xl shadow-[0_6px_0_0_rgba(0,0,0,0.10)] px-5 py-5">
          <p className="font-display text-[clamp(1.1rem,5.5vw,1.6rem)] leading-tight text-ink text-center break-words">
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
      </div>

      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 pointer-events-none">
        <div className="w-20 h-20 rounded-full bg-white shadow-lg flex items-center justify-center">
          <Image src="/mascot.png" alt="" width={56} height={56} />
        </div>
      </div>
    </div>
  );
}

function ReadyOverlay({ count }: { count: number }) {
  const { t } = useLang();
  const isGo = count === 0;
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-7 bg-teal text-white px-6 text-center">
      <div className="font-display text-xl tracking-[0.3em] indent-[0.3em] uppercase opacity-90">
        {t.getReady}
      </div>
      <Image src="/mascot.png" alt="" width={112} height={112} priority />
      <h1 className="font-display text-5xl leading-tight">{t.tapCorrect}</h1>
      <div className="flex flex-col gap-2 font-display text-2xl leading-tight">
        <p>{t.rulesTime}</p>
        <p>{t.rulesMiss}</p>
      </div>
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
