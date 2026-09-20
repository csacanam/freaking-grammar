// Ticket rule for the daily pot draw — client-safe constants (no viem
// imports here: PotCard renders the rule line, and pulling hashing utils
// into the client bundle for three numbers would be waste).
//
// A paid finished run earns 1 ticket for playing plus 1 per TICKET_STEP
// points, capped at MAX_TICKETS_PER_RUN. Only a wallet's best
// RUNS_CAP_PER_WALLET runs of the day count.
//
// Why the cap is the load-bearing piece: score→tickets UNCAPPED is an API
// for bots — one perfect $0.10 run would buy ~30 tickets and every other
// ticket in the pool would look visibly dead. Capped at 3, a perfect run
// earns what a good human run earns, and the only way to buy more odds is
// more paid runs — which is revenue and pot growth, from bots included.
//
// Steps are calibrated on the REAL paying population (last 30d, flagged
// wallets excluded): paid-run medians are tiny (EN 2, ES 1, MATH 5), so the
// step sits near the payers' p75/p90 — reachable with effort, not reserved
// for the elite: EN 8 (p75=6, p90=11), ES 3 (p75=2, p90=4), MATH 8 (p50=5,
// p75=11).

export const TICKET_STEP_BY_GAME: Record<number, number> = {
  1: 8, // Grammar EN
  2: 3, // Grammar ES
  3: 8, // Math
};
export const DEFAULT_TICKET_STEP = 8;

export const MAX_TICKETS_PER_RUN = 3;
export const RUNS_CAP_PER_WALLET = 5;

export function ticketStepFor(gameId: number): number {
  return TICKET_STEP_BY_GAME[gameId] ?? DEFAULT_TICKET_STEP;
}

export function ticketsForScore(score: number, gameId: number): number {
  return Math.min(
    1 + Math.floor(score / ticketStepFor(gameId)),
    MAX_TICKETS_PER_RUN,
  );
}
