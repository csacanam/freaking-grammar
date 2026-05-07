// Server-side generator for Freaking Math questions. Math doesn't use a
// curated question bank like Grammar — each round is synthesized fresh
// from the player's current streak (q_index). Difficulty rises across
// three independent axes so the player feels heat from every angle:
//
//   1. NUMBER MAGNITUDE  — operands grow with q_index (1-9 → 1-12 → 1-20)
//   2. OPERATION MIX     — early rounds skew to +/-, later rounds bring
//                          in × and finally exact ÷
//   3. WRONG-ANSWER PLAUSIBILITY — early wrong answers are obviously
//                          off (5+3=20). Mid-game they're off-by-2 or
//                          off-by-3. Late game they're off-by-1, the
//                          stuff that fools your brain at 1.5s/glance
//
// The classic Freaking Math curve (VnEspoir, 2014) gates difficulty by
// number size, not by operation type. This generator follows that —
// mixing operations from question 1 means a player never hits a wall
// like "I can't multiply, so I'm capped at level 2."

import { randomInt } from "node:crypto";

export type MathOp = "+" | "-" | "x" | "/";

export type MathQuestion = {
  left: number;
  right: number;
  op: MathOp;
  shown: number;       // the result the player sees on screen
  truth: boolean;      // true if `shown` is the actual answer, false if a decoy
  trueResult: number;  // the actual mathematical result
};

// Difficulty band for a given streak position. Each band specifies the
// operand size + which ops are eligible + how plausibly wrong the
// decoys can get. Bands overlap intentionally so the curve feels
// gradual, not stepped (the original Freaking Math never made a
// "level up" announcement — it just got harder).
type DifficultyBand = {
  maxOperand: number;
  ops: MathOp[];
  // distance from the true answer when generating a wrong decoy.
  // smaller = harder (closer to correct → harder to spot). Generator
  // picks uniformly from this list, so a band with [1, 2] alternates
  // off-by-1 and off-by-2 within the same streak position.
  decoyDeltas: number[];
};

function bandForStreak(q: number): DifficultyBand {
  // Q0-4: warm-up. Big numbers OK but only +/-, decoys are obvious.
  if (q < 5) return { maxOperand: 9, ops: ["+", "-"], decoyDeltas: [3, 5, 7, 10] };
  // Q5-14: × shows up. Numbers stay small. Decoys tighten.
  if (q < 15) return { maxOperand: 12, ops: ["+", "-", "x"], decoyDeltas: [2, 3, 5] };
  // Q15-29: full mix incl. ÷. Decoys mostly off-by-2.
  if (q < 30) return { maxOperand: 12, ops: ["+", "-", "x", "/"], decoyDeltas: [1, 2, 3] };
  // Q30+: max difficulty. Off-by-1 dominates. Larger products possible.
  return { maxOperand: 15, ops: ["+", "-", "x", "/"], decoyDeltas: [1, 1, 2] };
}

// Time budget per question, smooth decay 3s → 1.5s. Driven by q_index
// so the curve is deterministic and matches what the client renders.
export function timeBudgetMs(q: number): number {
  if (q < 1) return 3000;       // first one is "no timer" handled by client; we still return a value
  if (q >= 30) return 1500;
  // Linear drop from 3000 at q=1 to 1500 at q=30 → ~52ms per step.
  const t = 3000 - ((q - 1) / 29) * 1500;
  return Math.round(t);
}

export function generateMathQuestion(qIndex: number): MathQuestion {
  const band = bandForStreak(qIndex);
  const op = band.ops[randomInt(0, band.ops.length)];
  const { left, right, trueResult } = pickOperands(op, band.maxOperand);

  // ~50% chance the shown result is the truth, ~50% a plausible decoy.
  // Mixing the truth/lie ratio prevents the "always tap incorrect"
  // strategy and keeps both buttons live.
  const showTruth = randomInt(0, 2) === 0;
  if (showTruth) {
    return { left, right, op, shown: trueResult, truth: true, trueResult };
  }
  const shown = decoyResult(trueResult, band.decoyDeltas);
  return { left, right, op, shown, truth: false, trueResult };
}

function pickOperands(op: MathOp, max: number): {
  left: number;
  right: number;
  trueResult: number;
} {
  switch (op) {
    case "+": {
      const a = randomInt(1, max + 1);
      const b = randomInt(1, max + 1);
      return { left: a, right: b, trueResult: a + b };
    }
    case "-": {
      // Force non-negative results: nerdos.fun's audience would balk
      // at "5 - 8 = -3". Keep it elementary.
      const a = randomInt(1, max + 1);
      const b = randomInt(1, a + 1);
      return { left: a, right: b, trueResult: a - b };
    }
    case "x": {
      // Cap × at maxOperand × maxOperand to avoid 14 × 12 sized brain
      // strain. Real Freaking Math kept multipliers small and used
      // time pressure as the difficulty multiplier.
      const a = randomInt(2, max + 1);
      const b = randomInt(2, max + 1);
      return { left: a, right: b, trueResult: a * b };
    }
    case "/": {
      // Generate by picking the divisor and the result first, then
      // multiplying — guarantees an integer result every time.
      const b = randomInt(2, Math.min(max, 10) + 1);
      const result = randomInt(1, Math.min(max, 12) + 1);
      const a = b * result;
      return { left: a, right: b, trueResult: result };
    }
  }
}

function decoyResult(trueResult: number, deltas: number[]): number {
  const delta = deltas[randomInt(0, deltas.length)];
  // Half the time add the delta, half subtract. Floor at 0 so we don't
  // show negative numbers (same UX argument as the subtraction rule).
  const sign = randomInt(0, 2) === 0 ? 1 : -1;
  let candidate = trueResult + sign * delta;
  if (candidate < 0) candidate = trueResult + delta;
  if (candidate === trueResult) candidate = trueResult + delta;
  return candidate;
}
