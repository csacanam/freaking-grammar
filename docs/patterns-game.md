# Patterns — game #4 spec

Status: **approved, not started**. Build after the daily-draw experiment
checkpoint (~2026-10-06) so the draw metrics stay clean. Decision made
2026-09-20; chosen over a Stroop-style reflex game for deeper mastery
progression (better daily-format retention and paid-replay motive) and a
healthier adversarial profile (new pattern families can be added server-side
at any time; sequence inference is computation, not lookup).

## The game

A sequence of emoji tokens plus a candidate "next" token. The player answers
whether the candidate continues the pattern — binary ✓/✗, one mistake ends
the run, streak is the score, timer shrinks per question. Identical loop to
Math.

```
🔺 🟦 🔺 🟦 🔺 ❓        Does 🟦 come next?   ✓ / ✗
```

- **Zero words** → one global pot (lang = NULL like Math), the widest
  possible funnel: no literacy or numeracy barrier, any country.
- **Zero assets** — emojis render natively on every phone; the sequence is
  plain text in the existing game UI, the answer buttons are Math's ✓/✗.
- **Generated, not banked.** Questions are sampled from parameter space
  (family × tokens × period × phase × visible length × decoy), the same way
  Math fabricates equations. The lesson from Grammar's finite 234-question
  bank: fixed banks get memorized; generators don't.

## Pattern families (MVP)

Difficulty ramps with the streak, like Math's shrinking timer:

| Streak | Families |
|---|---|
| 0–2 | Cycle period 2 (ABAB…) — tutorial-easy |
| 3–6 | Cycle period 3 · growing blocks (A BB AAA…) flattened |
| 7–11 | Cycle period 4 · rotation (arrows/moons, step 1–2) |
| 12–17 | Mirror/palindrome cycles (ABCBA…) |
| 18+ | Dual-axis (shape alternates × color cycles, offset periods) |

Decoys are always drawn from the sequence's own alphabet (never a foreign
token), so wrong candidates stay plausible. The family list is expected to
grow post-launch — each new family is ~30 lines in the generator.

## Launch checklist

1. **On-chain**: `initGame(4, 300000)` — owner-only, no contract redeploy
   (`FreakingPot.sol` accepts any fresh gameId).
2. **Generator**: `src/lib/pattern-questions.ts`, mirroring
   `math-questions.ts`. Server-authoritative: the client receives sequence +
   candidate only, never the truth — correctness is checked server-side
   against what was stored at serve time (Grammar's leaked-answer lesson).
3. **DB**: `run_questions` gains `pattern_data jsonb` (sequence, candidate,
   is_correct) — mirrors Math's `math_left/right/op/shown` columns.
4. **Routes**: clone the `/api/math/runs` trio (start / answer / finish),
   including the min-answer-time floor and shrinking timer budget.
5. **Buckets** (all game-agnostic already, just add gameId 4): roll-day
   `BUCKETS`, treasury-alert `GAMES`, `draw-config` ticket step (start at 8;
   recalibrate against the paid-run p75 after two weeks of real data),
   `/api/draw` `BUCKETS`, email-data `GAMES`, picker + lobby UI (clone
   `/math` pages).
6. **Terms**: add the game to the list in §1.

## Economics

Same as every game under the daily draw: $0.10 entry → $0.08 to the pot,
$0.02 protocol; 1–3 tickets per paid run by score; daily seed $0.30. Launch
risk is near zero: on days with no tickets the pot carries over and the
treasury isn't drawn, so an unplayed game costs its seed once — not per day.

Estimated build: ~2 days. A working generator prototype exists locally
(gitignored) and produced ~25k distinct questions from the MVP parameter
space alone; the space scales multiplicatively with each added family,
token, or phase.
