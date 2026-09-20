// Public draw-audit endpoint: everything needed to independently verify a
// settled day's pot draw.
//
//   GET /api/draw?day=YYYY-MM-DD
//
// For each game it returns the frozen inputs recorded at settlement (ticket
// list, seed, boundary block) plus a live re-verification:
//   1. seedCheck  — re-derives keccak256(blockHash ‖ gameId) from the chain
//                   and compares it to the stored seed. The block hash comes
//                   from Celo, not from us, so a forged seed can't pass.
//   2. winnerCheck — re-expands the stored ticket list (run id order, one
//                   slot per ticket), takes seed % totalTickets, and compares
//                   the landed player to the recorded winner.
//
// Anyone can redo both steps offline: the block hash is on any Celo explorer,
// the hashing is standard keccak256, and each player can confirm their own
// run ids appear in the list with the right ticket count (run ids are handed
// to the client at run start). What the snapshot can't prove by itself is
// completeness — that no paid run was silently omitted — which is exactly
// what per-player spot-checks of their own runs cover.
//
// The ticket list is frozen AT settlement (pots.draw_entries) rather than
// recomputed here: a wallet blacklisted after the draw would drop out of a
// live recompute and produce a false mismatch.

import type { NextRequest } from "next/server";
import { supabase, todayUtc } from "@/lib/supabase";
import { celoClient } from "@/lib/onchain";
import { drawSeedForGame, pickWinnerIndex } from "@/lib/draw";
import {
  MAX_TICKETS_PER_RUN,
  RUNS_CAP_PER_WALLET,
  ticketStepFor,
} from "@/lib/draw-config";

export const dynamic = "force-dynamic";

const BUCKETS = [
  { label: "grammar-en", game: "grammar", gameId: 1, lang: "en" as const },
  { label: "grammar-es", game: "grammar", gameId: 2, lang: "es" as const },
  { label: "math", game: "math", gameId: 3, lang: null },
];

type StoredEntry = {
  runId: string;
  player: string;
  score: number;
  tickets: number;
};

export async function GET(req: NextRequest) {
  if (!supabase) {
    return Response.json({ error: "db-unconfigured" }, { status: 503 });
  }
  const day = req.nextUrl.searchParams.get("day") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return Response.json(
      { error: "invalid-day", hint: "use ?day=YYYY-MM-DD" },
      { status: 400 },
    );
  }
  if (day >= todayUtc()) {
    return Response.json(
      { error: "day-not-settled", hint: "only closed days have a draw" },
      { status: 400 },
    );
  }

  const games = [];
  for (const b of BUCKETS) {
    let q = supabase
      .from("pots")
      .select(
        "day_utc,day_number,amount_units,winner,winner_score,closed,draw_seed,draw_block,draw_tickets,draw_entries",
      )
      .eq("game", b.game)
      .eq("day_utc", day);
    // PostgREST needs .is() for null lang (math), .eq() otherwise.
    q = b.lang === null ? q.is("lang", null) : q.eq("lang", b.lang);
    const { data: row, error } = await q.maybeSingle();
    if (error) {
      // Most likely a missing draw_* column (migration not applied). Say so
      // instead of masquerading as "day doesn't exist".
      games.push({ game: b.label, status: "query-error", detail: error.message });
      continue;
    }
    if (!row) {
      games.push({ game: b.label, status: "no-pot-row" });
      continue;
    }

    const base = {
      game: b.label,
      gameId: b.gameId,
      dayNumber: row.day_number,
      potUnits: String(row.amount_units),
      winner: row.winner,
      winnerScore: row.winner_score,
      rule: {
        ticketStep: ticketStepFor(b.gameId),
        maxTicketsPerRun: MAX_TICKETS_PER_RUN,
        runsCapPerWallet: RUNS_CAP_PER_WALLET,
      },
    };

    if (!row.draw_seed) {
      // Pre-draw day (legacy top-score) or a draw with zero tickets.
      games.push({
        ...base,
        status:
          row.draw_tickets === 0
            ? "no-tickets-pot-carried-over"
            : "legacy-top-score-day",
      });
      continue;
    }

    const entries = ((row.draw_entries ?? []) as StoredEntry[])
      .slice()
      .sort((a, c) => (a.runId < c.runId ? -1 : a.runId > c.runId ? 1 : 0));

    // Re-expand exactly like the settlement did: run id order, one slot per
    // ticket, index = seed % total.
    const expanded: StoredEntry[] = [];
    for (const e of entries) {
      for (let k = 0; k < e.tickets; k++) expanded.push(e);
    }
    let winnerCheck: { index: number; player: string; matches: boolean } | null =
      null;
    if (expanded.length > 0) {
      const idx = pickWinnerIndex(row.draw_seed as `0x${string}`, expanded.length);
      const landed = expanded[idx].player;
      winnerCheck = {
        index: idx,
        player: landed,
        matches: !!row.winner && landed === row.winner.toLowerCase(),
      };
    }

    // Chain-side check: re-derive the seed from the boundary block hash.
    // Best-effort — an RPC hiccup yields null, never a false "failed".
    let seedCheck: {
      blockHash: string;
      derivedSeed: string;
      matches: boolean;
    } | null = null;
    if (row.draw_block != null) {
      try {
        const blk = await celoClient.getBlock({
          blockNumber: BigInt(row.draw_block),
        });
        if (blk.hash) {
          const derived = drawSeedForGame(blk.hash, b.gameId);
          seedCheck = {
            blockHash: blk.hash,
            derivedSeed: derived,
            matches: derived === row.draw_seed,
          };
        }
      } catch {
        /* explorer links below still let anyone check by hand */
      }
    }

    games.push({
      ...base,
      status: "drawn",
      draw: {
        seed: row.draw_seed,
        boundaryBlock: row.draw_block,
        totalTickets: row.draw_tickets,
        entries,
      },
      verification: {
        seedCheck,
        winnerCheck,
        blockExplorer:
          row.draw_block != null
            ? `https://celoscan.io/block/${row.draw_block}`
            : null,
      },
    });
  }

  return Response.json({
    day,
    howToVerify: [
      "1. Fetch the boundary block hash from any Celo explorer (see blockExplorer).",
      "2. seed = keccak256(abi.encodePacked(blockHash, uint256(gameId))) — must equal draw.seed.",
      "3. Sort entries by runId asc, expand each run into `tickets` consecutive slots.",
      "4. winner = entries[seed mod totalTickets].player — must equal the recorded winner.",
      "5. Your own runIds (shown to you when each run starts) must appear with the right ticket count.",
    ],
    games,
  });
}
