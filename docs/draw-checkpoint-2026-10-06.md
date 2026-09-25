# Daily-draw checkpoint — pending work

Status: **pending, due ~2026-10-06.** Read this first when resuming work on
the pot, bots, or the next game. It lists what is already live, what is
parked behind the checkpoint, and the order to do it in.

## Why there is a checkpoint

On 2026-09-21 the pot stopped going to the day's top score and became a
daily ticket draw (`src/lib/draw.ts`, `src/lib/draw-config.ts`). The
question the experiment answers: **does a winnable prize bring back paid
plays?** Anything that changes what players see in the lobby before the
read would confound it, so the follow-ups below wait.

## Already live (no action needed)

| Since | What | Where |
|---|---|---|
| 09-21 | Ticket draw: 1 ticket per paid play + 1 per step of points, **max 3 per play**, unlimited plays. Seed = first Celo block after UTC midnight. | `drawPotWinner` in `src/app/api/cron/roll-day/route.ts` |
| 09-21 | Public audit endpoint | `GET /api/draw?day=YYYY-MM-DD` |
| 09-24 | History shows how each draw was decided: block, time, hash, seed, winning ticket, every ticket range | `src/components/DrawProofDetails.tsx`, `src/lib/draw-proof.ts` |
| 09-24 | The draw excludes **only manual bans** (`bot_wallets.reason = 'manual'`). Automatic bot flags never remove paid tickets. | `loadManualBlacklist` in `src/lib/bot-detection.ts` |
| 09-24 | `BOT_FRIENDLY` flag shipped **off** | `src/lib/bot-detection.ts` |

`MAX_TICKETS_PER_RUN = 3` is load-bearing: it is what keeps score from
deciding the pot. Don't raise or remove it casually.

## Step 1 — read the experiment (~10-06)

Compare paid plays per day and distinct winners against the pre-draw
weeks (the `/stats` page has paid plays per day with the break-even line).

- Paid plays up materially → keep the draw.
- Paid plays flat but more distinct winners → keep it (fairness), and look
  at retention rather than the prize as the conversion lever.
- Paid plays down → consider a higher per-play ticket cap or a separate
  skill prize before reverting.

## Step 2 — turn on bot-friendly mode (after step 1)

Decided 2026-09-24. Under the draw a bot can't take anything from anyone:
free plays earn no tickets, and a paid play earns at most 3 tickets like any
good human play. Hiding "bots" now only costs false positives on fast humans
plus upkeep.

1. Vercel → Project → Environment Variables (Production): add
   `BOT_FRIENDLY` = `1`, then redeploy.
2. Delete `BOT_LIVE_SCORE_MAX_MATH` from Production. It does nothing while
   the flag is on; this is cleanup.
3. What changes: no automatic `bot_wallets` writes, the `sweep-bots` cron
   idles, and the lobby and stats leaderboards hide only manual bans.
   Previously flagged wallets reappear on the leaderboards.
4. Measure it as its own change for ~2 weeks: human free→paid conversion
   and D1/D7 retention against the prior window. The risk being tested is
   whether high bot scores on the leaderboard (glory only) discourage humans.
5. Rollback: remove the env var and redeploy. No code change needed.

Manual bans (ops-confirmed fraud, e.g. exploiting payments or the game)
keep working in every mode.

## Step 3 — code cleanup (once step 2 sticks)

- The grammar answer-key test and the top-score winner path
  (`pickTopScoreWinner`) only serve settlements before 2026-09-21. Delete
  them once no pre-draw day can still be settled late.
- If bot-friendly mode stays on, remove the automatic-flag code and the
  `sweep-bots` cron entry in `vercel.json` rather than keeping them dark
  forever.

## Step 4 — next game

Patterns (game #4) is approved and waits for this checkpoint; see
`docs/patterns-game.md`.
