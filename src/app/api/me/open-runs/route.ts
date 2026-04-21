// Surfaces paid plays the user has made on-chain today that were never
// completed client-side (bug, tab close, network hiccup, whatever). The Home
// turns this into a "Resume →" banner so nobody eats a paid turn. Strictly
// scoped to today UTC — yesterday's pot is already closed and distributed,
// so surfacing those would only be noise without action.

import type { NextRequest } from "next/server";
import { createPublicClient, http, parseAbiItem } from "viem";
import { celo } from "viem/chains";
import { POT_ADDRESS } from "@/lib/chain";
import { supabase } from "@/lib/supabase";
import type { Lang } from "@/lib/i18n";

// Use forno (public Celo RPC) specifically for getLogs. Alchemy's free tier
// caps eth_getLogs to a 10-block range which is useless for a 24h scan.
// Forno allows wide ranges but can rate-limit under heavy load; acceptable
// here because this is a best-effort recovery tool, not the hot path.
const fornoClient = createPublicClient({
  chain: celo,
  transport: http("https://forno.celo.org"),
});

export const dynamic = "force-dynamic";

type ResumablePlay = {
  txHash: string;
  lang: Lang;
  gameId: 1 | 2;
  paidAtIso: string;
};

const PLAYED_EVENT = parseAbiItem(
  "event Played(uint256 indexed gameId, uint256 indexed day, address indexed player, bool wasFree, uint256 potAfter)",
);

// Rough 24h window of Celo blocks (~5s per block). Bumped a bit for safety.
const LOOKBACK_BLOCKS = 20_000n;

function todayUtcBoundsSec(): { start: number; end: number } {
  const d = new Date();
  const start = Math.floor(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000,
  );
  return { start, end: start + 86_400 };
}

export async function GET(req: NextRequest) {
  const player = req.nextUrl.searchParams.get("player")?.toLowerCase();
  if (!player || !/^0x[0-9a-f]{40}$/.test(player)) {
    return Response.json([] as ResumablePlay[]);
  }
  if (!supabase) return Response.json([] as ResumablePlay[]);

  let events;
  try {
    const latest = await fornoClient.getBlockNumber();
    events = await fornoClient.getLogs({
      address: POT_ADDRESS,
      event: PLAYED_EVENT,
      args: { player: player as `0x${string}` },
      fromBlock: latest > LOOKBACK_BLOCKS ? latest - LOOKBACK_BLOCKS : 0n,
      toBlock: "latest",
    });
  } catch (e) {
    console.error("open-runs: getLogs failed:", e);
    return Response.json([] as ResumablePlay[]);
  }

  if (events.length === 0) return Response.json([] as ResumablePlay[]);

  // Narrow to today's UTC day via block timestamps. The event itself doesn't
  // expose block time, so batch-fetch blocks we haven't seen.
  const { start, end } = todayUtcBoundsSec();
  const blockCache = new Map<string, number>();
  const playedToday: {
    txHash: string;
    gameId: number;
    wasFree: boolean;
    blockTime: number;
  }[] = [];
  for (const ev of events) {
    const blockKey = ev.blockHash;
    let blockTime = blockCache.get(blockKey);
    if (blockTime === undefined) {
      try {
        const blk = await fornoClient.getBlock({ blockHash: blockKey });
        blockTime = Number(blk.timestamp);
        blockCache.set(blockKey, blockTime);
      } catch {
        continue;
      }
    }
    if (blockTime < start || blockTime >= end) continue;
    // Paid plays only — free plays don't hold any USDT, so surfacing them as
    // "paid but unplayed" would be misleading. Still worth recovering free
    // plays in principle, but that's a different UX bucket (TODO if users
    // complain). For now: strictly paid.
    if (ev.args.wasFree) continue;
    playedToday.push({
      txHash: ev.transactionHash,
      gameId: Number(ev.args.gameId),
      wasFree: Boolean(ev.args.wasFree),
      blockTime,
    });
  }

  if (playedToday.length === 0) return Response.json([] as ResumablePlay[]);

  // Cross-reference with DB. A Played event is "resumable" if:
  //   - No run row exists for its txHash (startRun never completed), OR
  //   - Run row exists, status=open, and no run_questions answered yet
  //     (server's idempotent endpoint can cleanly serve q=0 again).
  const txHashes = playedToday.map((p) => p.txHash.toLowerCase());
  const { data: rowsData } = await supabase
    .from("runs")
    .select("id,paid_tx_hash,status")
    .in("paid_tx_hash", txHashes);
  const rows = (rowsData ?? []) as Array<{
    id: string;
    paid_tx_hash: string;
    status: string;
  }>;
  const rowByTx = new Map(rows.map((r) => [r.paid_tx_hash.toLowerCase(), r]));

  // Fetch answered state for the open ones.
  const openRunIds = rows.filter((r) => r.status === "open").map((r) => r.id);
  let answeredRunIds = new Set<string>();
  if (openRunIds.length > 0) {
    const { data: rqData } = await supabase
      .from("run_questions")
      .select("run_id,answered_at")
      .in("run_id", openRunIds);
    const rqs = (rqData ?? []) as Array<{
      run_id: string;
      answered_at: string | null;
    }>;
    answeredRunIds = new Set(
      rqs.filter((r) => r.answered_at !== null).map((r) => r.run_id),
    );
  }

  const resumable: ResumablePlay[] = [];
  for (const p of playedToday) {
    const row = rowByTx.get(p.txHash.toLowerCase());
    if (!row) {
      // No row at all — server rejected before insert.
      resumable.push({
        txHash: p.txHash,
        lang: p.gameId === 2 ? "es" : "en",
        gameId: p.gameId === 2 ? 2 : 1,
        paidAtIso: new Date(p.blockTime * 1000).toISOString(),
      });
      continue;
    }
    if (row.status !== "open") continue;
    if (answeredRunIds.has(row.id)) continue;
    resumable.push({
      txHash: p.txHash,
      lang: p.gameId === 2 ? "es" : "en",
      gameId: p.gameId === 2 ? 2 : 1,
      paidAtIso: new Date(p.blockTime * 1000).toISOString(),
    });
  }

  // Oldest first — most at risk of expiring at 00:00 UTC rollover.
  resumable.sort((a, b) => a.paidAtIso.localeCompare(b.paidAtIso));

  return Response.json(resumable);
}
