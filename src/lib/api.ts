// Client wrapper. Hits same-origin Next.js route handlers under /api/*.
// Every call takes a `lang` ("en" | "es") — same app, two games.

import type { Lang } from "@/lib/i18n";

export type LobbyData = {
  potUSD: number;
  closesAtIso: string;
  leaderboard: { rank: number; player: string; score: number; isMe?: boolean }[];
  playerHasFreePlay: boolean;
};

export type HistoryDay = {
  date: string;
  potUSD: number;
  winner: string | null;
  winnerScore: number | null;
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

export async function getHistory(lang: Lang): Promise<HistoryDay[]> {
  const r = await fetch(`/api/history${q({ lang })}`, { cache: "no-store" });
  return r.json();
}

export async function getStats(lang: Lang, player?: string): Promise<StatsData> {
  const r = await fetch(`/api/me/stats${q({ lang, player })}`, { cache: "no-store" });
  return r.json();
}

export async function getUnclaimed(lang: Lang, player?: string): Promise<UnclaimedWin[]> {
  const r = await fetch(`/api/me/unclaimed${q({ lang, player })}`, { cache: "no-store" });
  return r.json();
}

// ---------------------------------------------------- runs / gameplay

export type RunQuestion = { phrase: string; correct: string; wrong: string };

export type StartRunResult = { runId: string; question: RunQuestion };

export type AnswerResult =
  | { correct: true; score: number; nextQuestion: RunQuestion }
  | { correct: true; ended: true; score: number; rank: number; reason: "cleared" }
  | { correct: false; ended: true; score: number; rank: number; reason: "wrong" };

export type FinishResult = { score: number; rank: number };

export async function startRun(
  lang: Lang,
  player: string,
  paidTxHash?: string,
): Promise<StartRunResult> {
  const r = await fetch(`/api/runs${q({ lang })}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ player, paidTxHash }),
  });
  if (!r.ok) throw new Error(`startRun failed: ${r.status}`);
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
