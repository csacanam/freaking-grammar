// Client wrapper. Hits same-origin Next.js route handlers under /api/*.
// Every call takes a `lang` ("en" | "es") — same app, two games.

import type { Lang } from "@/lib/i18n";

export type BonusLine = {
  sponsor: string;
  emoji: string | null;
  amount: number;
  tokenSymbol: string;
};

export type LobbyData = {
  potUSD: number;
  closesAtIso: string;
  leaderboard: { rank: number; player: string; score: number; isMe?: boolean }[];
  playerHasFreePlay: boolean;
  bonuses?: BonusLine[];
};

export type HistoryDay = {
  date: string;
  potUSD: number;
  winner: string | null;
  winnerScore: number | null;
  bonuses?: BonusLine[];
};

export type StatsData = {
  gamesPlayed: number;
  wins: number;
  totalEarnedUSD: number;
};

export type UnclaimedWin = {
  date: string;
  amountUSD: number;
  dayNumber: number;
  game: "grammar" | "math";
  gameId: number;
  lang: "en" | "es" | null;
};

function q(params: Record<string, string | undefined>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined) as [
    string,
    string,
  ][];
  if (entries.length === 0) return "";
  return "?" + new URLSearchParams(entries).toString();
}

export async function getLobby(lang: Lang, player?: string): Promise<LobbyData> {
  const r = await fetch(`/api/lobby${q({ lang, player })}`, { cache: "no-store" });
  return r.json();
}

export async function getMathLobby(player?: string): Promise<LobbyData> {
  const r = await fetch(`/api/math/lobby${q({ player })}`, { cache: "no-store" });
  return r.json();
}

export async function getMathHistory(): Promise<HistoryDay[]> {
  const r = await fetch(`/api/math/history`, { cache: "no-store" });
  return r.json();
}

export async function getHistory(lang: Lang): Promise<HistoryDay[]> {
  const r = await fetch(`/api/history${q({ lang })}`, { cache: "no-store" });
  return r.json();
}

// Both endpoints below dropped their `lang` param when Math launched —
// they aggregate across every game now so a Math-only winner sees their
// stats and unclaimed prize, not just Grammar activity.
export async function getStats(player?: string): Promise<StatsData> {
  const r = await fetch(`/api/me/stats${q({ player })}`, { cache: "no-store" });
  return r.json();
}

export async function getUnclaimed(player?: string): Promise<UnclaimedWin[]> {
  const r = await fetch(`/api/me/unclaimed${q({ player })}`, { cache: "no-store" });
  return r.json();
}

export type OpenRun = {
  txHash: string;
  game: "grammar" | "math";
  lang: Lang | null;     // null for Math (no language split)
  gameId: 1 | 2 | 3;
  paidAtIso: string;
};

// Paid plays on-chain today that never completed a run. Home shows these as
// "Resume →" so nobody eats a paid turn to a client-side bug or a tab close.
export async function getOpenRuns(player?: string): Promise<OpenRun[]> {
  if (!player) return [];
  const r = await fetch(`/api/me/open-runs${q({ player })}`, {
    cache: "no-store",
  });
  if (!r.ok) return [];
  return r.json();
}

// ---------------------------------------------------- runs / gameplay

// The two word options for a question, already SHUFFLED server-side. The
// client no longer receives which one is correct — that used to leak the
// answer (a bot could read `correct` and echo it back). Correctness is now
// only known after submitting, from the server's `correct` boolean.
export type RunQuestion = { phrase: string; options: [string, string] };

export type StartRunResult = { runId: string; question: RunQuestion };

export type AnswerResult =
  | { correct: true; score: number; nextQuestion: RunQuestion }
  | { correct: true; ended: true; score: number; rank: number; reason: "cleared" }
  | {
      correct: false;
      ended: true;
      score: number;
      rank: number;
      reason: "wrong" | "timeout";
    };

export type FinishResult = { score: number; rank: number };

export async function startRun(
  lang: Lang,
  player: string,
  txHash: string,
): Promise<StartRunResult> {
  const r = await fetch(`/api/runs${q({ lang })}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ player, txHash }),
  });
  if (!r.ok) {
    // Surface the server-reported reason so the retry overlay can say
    // something useful instead of a bare status code.
    let reason = String(r.status);
    try {
      const body = (await r.json()) as { error?: string };
      if (body?.error) reason = body.error;
    } catch {
      /* non-JSON body */
    }
    throw new Error(`startRun failed: ${reason}`);
  }
  return r.json();
}

export async function submitAnswer(
  runId: string,
  pickedWord: string,
): Promise<AnswerResult> {
  const r = await fetch(`/api/runs/${encodeURIComponent(runId)}/answer`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pickedWord }),
  });
  if (!r.ok) throw new Error(`submitAnswer failed: ${r.status}`);
  return r.json();
}

export async function finishRun(
  runId: string,
  reason: "timeout" | "abandoned",
): Promise<FinishResult> {
  const r = await fetch(`/api/runs/${encodeURIComponent(runId)}/finish`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reason }),
  });
  if (!r.ok) throw new Error(`finishRun failed: ${r.status}`);
  return r.json();
}

// ----- MATH game flow

export type MathQuestion = {
  left: number;
  right: number;
  op: "+" | "-" | "x" | "/";
  shown: number;
};

export type MathStartResult = { runId: string; question: MathQuestion };

export type MathAnswerResult =
  | { correct: true; score: number; nextQuestion: MathQuestion }
  | { correct: false; ended: true; score: number; rank: number; reason: "wrong" };

export async function startMathRun(
  player: string,
  txHash: string,
): Promise<MathStartResult> {
  const r = await fetch("/api/math/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ player, txHash }),
  });
  if (!r.ok) {
    let reason = String(r.status);
    try {
      const body = (await r.json()) as { error?: string };
      if (body?.error) reason = body.error;
    } catch {
      /* non-JSON body */
    }
    throw new Error(`startMathRun failed: ${reason}`);
  }
  return r.json();
}

export async function submitMathAnswer(
  runId: string,
  choice: "correct" | "incorrect",
): Promise<MathAnswerResult> {
  const r = await fetch(`/api/math/runs/${encodeURIComponent(runId)}/answer`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ choice }),
  });
  if (!r.ok) throw new Error(`submitMathAnswer failed: ${r.status}`);
  return r.json();
}

export async function finishMathRun(
  runId: string,
  reason: "timeout" | "abandoned",
): Promise<FinishResult> {
  const r = await fetch(`/api/math/runs/${encodeURIComponent(runId)}/finish`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reason }),
  });
  if (!r.ok) throw new Error(`finishMathRun failed: ${r.status}`);
  return r.json();
}
