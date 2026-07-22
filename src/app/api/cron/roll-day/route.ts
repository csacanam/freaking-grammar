import type { NextRequest } from "next/server";
import { createWalletClient, zeroAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { supabase, todayUtc } from "@/lib/supabase";
import { CELO_TRANSPORT, POT_ADDRESS } from "@/lib/chain";
import { FREAKING_POT_ABI, celoClient, readPotAmount } from "@/lib/onchain";
import {
  checkBotPlayer,
  loadBotBlacklist,
  type BotFlag,
} from "@/lib/bot-detection";
import { sendTelegramMessage } from "@/lib/telegram";

export const dynamic = "force-dynamic";
// 60s ceiling: a normal run is ~10s (heuristic walk + 2× on-chain
// rollDay), but a cold start + a few new bot candidates can push close
// to 20-30s. Without this declaration Vercel applies its plan default
// (10s on Hobby) and silently 504s mid-flight. Pro plan supports up to
// 60s; if you ever upgrade to Enterprise you can lift this further.
export const maxDuration = 60;

type Pot = {
  lang: string;
  day_utc: string;
  day_number: number;
  amount_units: string | number;
  closed: boolean;
  rolled_tx: string | null;
};

// Daily rollover. Vercel Cron hits this at 00:00 UTC. For each language:
//   1. Close yesterday's pot in the DB with its winner.
//   2. Insert a `wins` row for the winner so they see it under Claim All.
//   3. Open today's pot.
//   4. Call contract.rollDay(gameId, winner) on Celo so the winner can claim.
//      Requires OPERATOR_PRIVATE_KEY and NEXT_PUBLIC_FREAKING_POT_CELO; skipped
//      gracefully when either is missing (pre-deploy).
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  if (!supabase) {
    return Response.json({ error: "db-unconfigured" }, { status: 503 });
  }

  const today = todayUtc();
  // Each settlement bucket: human-readable label, the game it belongs
  // to, the gameId on-chain, and (for grammar) which UI language. Math
  // has lang=null because it's one global pot. New games slot in here.
  const buckets: Bucket[] = [
    { label: "EN", game: "grammar", gameId: 1, lang: "en" },
    { label: "ES", game: "grammar", gameId: 2, lang: "es" },
    { label: "MATH", game: "math", gameId: 3, lang: null },
  ];

  const results: Array<{ label: string; result: LangResult }> = [];
  for (const b of buckets) {
    results.push({ label: b.label, result: await rollPot(b, today) });
  }

  // Single consolidated Telegram for every settled bucket. Sent on
  // every settlement run (not only when bots were caught) so the
  // operator gets a daily heartbeat with winners + any new heuristic
  // flags attached. Skipped buckets (already-open, no-db) stay silent
  // — only "real" settlements produce a line.
  await sendSettlementSummary(results).catch(() => {});

  return Response.json({ today, results });
}

async function sendSettlementSummary(
  results: Array<{ label: string; result: LangResult }>,
): Promise<void> {
  const firstSettled = results.find(
    (r): r is { label: string; result: Extract<LangResult, { status: "settled" }> } =>
      r.result.status === "settled",
  );
  if (!firstSettled) return; // nothing meaningful happened (e.g. alreadyOpen)

  const day = firstSettled.result.closed.day;

  const lines: string[] = [`🎲 *Settlement ${day}*`];

  for (const { label, result: r } of results) {
    if (r.status !== "settled") {
      lines.push("", `*${label}* — ${r.reason}`);
      continue;
    }
    const c = r.closed;
    const winnerLine = c.winner
      ? `✅ Winner: \`${c.winner.slice(0, 6)}…${c.winner.slice(-4)}\` (score ${c.winnerScore})`
      : `⚠️ No clean winner — pot rolls forward.`;
    lines.push("", `*${label} → ${c.day}*`, winnerLine);
    if (r.skipped.length > 0) {
      lines.push(`🆕 auto-flagged ${r.skipped.length} new bot(s):`);
      for (const s of r.skipped) {
        const stats =
          s.reason === "heuristic" &&
          s.correctRate !== undefined &&
          s.p50ms !== undefined &&
          s.sampleSize !== undefined
            ? `correct=${(s.correctRate * 100).toFixed(1)}%, p50=${s.p50ms}ms${s.relSpread !== undefined ? `, spread=${s.relSpread.toFixed(2)}` : ""}, n=${s.sampleSize}`
            : "blacklisted";
        lines.push(
          `   \`${s.player.slice(0, 6)}…${s.player.slice(-4)}\` score=${s.score} — ${stats}`,
        );
      }
    }
  }

  await sendTelegramMessage(lines.join("\n"));
}

type LangResult =
  | {
      status: "settled";
      closed: {
        day: string;
        winner: string | null;
        winnerScore: number | null;
        rolledTx: string | null;
      };
      skipped: Array<{
        player: string;
        score: number;
        reason: "blacklist" | "heuristic";
        correctRate?: number;
        p50ms?: number;
        sampleSize?: number;
        relSpread?: number;
      }>;
      opened: string;
      day_number: number;
    }
  | { status: "skipped"; reason: string };

type Bucket = {
  label: string;
  game: "grammar" | "math";
  gameId: number;
  // Only meaningful for grammar (en/es). Math doesn't have a language
  // — `null` here, and the wins/sponsor_payouts PKs have moved off
  // `lang` onto `game_id` so a null lang doesn't break uniqueness.
  lang: "en" | "es" | null;
};

// PostgREST .eq(col, null) does NOT match — it requires .is(col, null).
// Math buckets carry lang=null; this small helper threads the right
// operator into a query so we can write the rest of the function as if
// lang was always a value.
function withLangFilter<T>(q: T, lang: "en" | "es" | null): T {
  // The `as any` is unavoidable because the supabase QueryBuilder
  // generic chain narrows on each call and TypeScript can't see that
  // both .eq and .is return the same shape.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (lang === null ? (q as any).is("lang", null) : (q as any).eq("lang", lang)) as T;
}

async function rollPot(b: Bucket, today: string): Promise<LangResult> {
  if (!supabase) return { status: "skipped", reason: "no-db" };

  const { data: last } = await withLangFilter(
    supabase
      .from("pots")
      .select("lang,day_utc,day_number,amount_units,closed,rolled_tx")
      .eq("game", b.game),
    b.lang,
  )
    .order("day_utc", { ascending: false })
    .limit(1)
    .maybeSingle();

  const lastPot = last as Pot | null;

  if (!lastPot) {
    await supabase.from("pots").insert({
      game: b.game,
      lang: b.lang,
      day_utc: today,
      day_number: 1,
      amount_units: 0,
      closed: false,
    });
    return { status: "skipped", reason: `bootstrapped day ${today}` };
  }

  if (lastPot.day_utc === today) {
    return { status: "skipped", reason: `already open: ${today}` };
  }

  const prevDay = lastPot.day_utc;
  let winner: string | null = null;
  let winnerScore: number | null = null;

  const skipped: Array<{ player: string; score: number; flag: BotFlag }> = [];
  const botBlacklist = await loadBotBlacklist(supabase);

  if (!lastPot.closed) {
    // Push the blacklist filter down into Postgres instead of pulling
    // bot rows just to drop them client-side. With the blacklist
    // short-circuited at the DB, the only candidates we ever see are
    // either truly clean or new wallets the heuristic still has to
    // evaluate. Two-layer filter (DB blocklist + correctRate/p50
    // heuristic) lives in src/lib/bot-detection.ts.
    //
    // Pagination is still here because heuristic-flagged wallets are
    // possible inside the result set (they're new, not yet in
    // bot_wallets) and dedup is still needed because each player can
    // own multiple runs on the same day.
    const blacklistArr = [...botBlacklist];
    const blacklistFilter =
      blacklistArr.length > 0
        ? `(${blacklistArr.map((p) => `"${p}"`).join(",")})`
        : null;

    const PAGE = 1000;
    const seen = new Set<string>();
    let offset = 0;
    let pickedWinner = false;
    walk: while (!pickedWinner) {
      let query = withLangFilter(
        supabase
          .from("runs")
          .select("player,score,ended_at")
          .eq("game", b.game),
        b.lang,
      )
        .eq("day_utc", prevDay)
        .eq("status", "finished")
        .gt("score", 0)
        .order("score", { ascending: false })
        .order("ended_at", { ascending: true })
        .range(offset, offset + PAGE - 1);
      if (blacklistFilter) {
        query = query.not("player", "in", blacklistFilter);
      }
      const { data: page } = await query;

      const candidates =
        (page as Array<{ player: string; score: number }> | null) ?? [];
      if (candidates.length === 0) break;

      for (const c of candidates) {
        const player = c.player.toLowerCase();
        if (seen.has(player)) continue;
        seen.add(player);

        // Pass the in-memory blacklist so the heuristic short-circuit
        // also catches wallets just-flagged earlier in this same loop
        // (cross-page dedup against fresh adds).
        const flag = await checkBotPlayer(player, supabase, botBlacklist, {
          game: b.game,
        });
        if (flag.flagged) {
          skipped.push({ player, score: c.score, flag });
          continue;
        }

        winner = player;
        winnerScore = c.score;
        pickedWinner = true;
        break walk;
      }

      if (candidates.length < PAGE) break;
      offset += PAGE;
    }

    await withLangFilter(
      supabase
        .from("pots")
        .update({ closed: true, winner, winner_score: winnerScore })
        .eq("game", b.game),
      b.lang,
    ).eq("day_utc", prevDay);

    if (winner && Number(lastPot.amount_units) > 0) {
      await supabase.from("wins").upsert(
        {
          game: b.game,
          game_id: b.gameId,
          lang: b.lang,
          day_utc: prevDay,
          player: winner,
          amount_units: lastPot.amount_units,
          claimed: false,
        },
        { onConflict: "game_id,day_utc,player" },
      );
    }
  }

  // Open today in the DB optimistically with lastPot.day_number + 1.
  // The block immediately below reconciles this against the on-chain
  // currentDay after rollDayOnChain — if the chain call failed for any
  // reason (RPC 429, gas underestimate, partial outage), currentDay
  // doesn't advance and the +1 here would be wrong forever, drifting
  // every subsequent claim() target by one day. The reconciliation
  // self-heals that.
  await supabase.from("pots").insert({
    game: b.game,
    lang: b.lang,
    day_utc: today,
    day_number: lastPot.day_number + 1,
    amount_units: 0,
    closed: false,
  });

  // On-chain rollDay. Skipped if already rolled (rolled_tx set) or if operator
  // key / contract address aren't configured yet.
  let rolledTx: string | null = lastPot.rolled_tx;
  if (!rolledTx) {
    rolledTx = await rollDayOnChain(b.gameId, winner);
    if (rolledTx) {
      await withLangFilter(
        supabase
          .from("pots")
          .update({ rolled_tx: rolledTx })
          .eq("game", b.game),
        b.lang,
      ).eq("day_utc", prevDay);
    }
  }

  // Reconcile today's day_number against on-chain currentDay.
  //
  // Two cases:
  //   A) rolledTx truthy → rollDay confirmed by receipt.status. Chain
  //      currentDay MUST be lastPot.day_number + 1. If readContract
  //      returns anything else, it's a stale read from a fallback RPC
  //      node (Forno/dRPC lag behind Alchemy when used as fallback —
  //      they can be 1+ blocks behind the block that just confirmed
  //      our write). Trust the optimistic value, do NOT overwrite.
  //      Overwriting with the stale value was what caused the 2026-06
  //      drift: every day's self-heal silently DECREMENTED today's
  //      day_number, then the next day's INSERT optimistically did +1
  //      from that bad base, so the drift persisted forever.
  //
  //   B) rolledTx null → rollDay was skipped or failed (rare race or
  //      RPC outage like 2026-05-31). Chain currentDay is the truth;
  //      the optimistic +1 we wrote is wrong. Fix BD to match chain.
  let chainDayNumber = lastPot.day_number + 1;
  if (POT_ADDRESS !== zeroAddress) {
    try {
      const onchain = (await celoClient.readContract({
        address: POT_ADDRESS,
        abi: FREAKING_POT_ABI,
        functionName: "currentDay",
        args: [BigInt(b.gameId)],
      })) as bigint;
      chainDayNumber = Number(onchain);
      const expected = lastPot.day_number + 1;
      if (chainDayNumber !== expected) {
        if (rolledTx) {
          // Case A: stale read after confirmed rollDay. Trust optimistic.
          console.warn(
            `stale currentDay read for ${b.label}: chain ${chainDayNumber}, expected ${expected} after confirmed rollDay ${rolledTx} — keeping optimistic ${expected}`,
          );
        } else {
          // Case B: rollDay didn't happen; trust chain.
          await withLangFilter(
            supabase
              .from("pots")
              .update({ day_number: chainDayNumber })
              .eq("game", b.game),
            b.lang,
          ).eq("day_utc", today);
          console.warn(
            `day_number drift fixed for ${b.label}: optimistic ${expected}, chain ${chainDayNumber}`,
          );
        }
      }
    } catch (e) {
      console.warn(
        `currentDay reconciliation failed for ${b.label}:`,
        (e as Error).message,
      );
    }
  }

  // Mirror today's pot amount (seed from treasury) from the contract.
  // Uses chain-reconciled day_number so the read hits the right pot —
  // critical when rollDay failed (chain pot for `lastPot+1` would
  // return 0 because that day was never opened on chain).
  if (POT_ADDRESS !== zeroAddress) {
    try {
      const seeded = await readPotAmount(b.gameId, chainDayNumber);
      await withLangFilter(
        supabase
          .from("pots")
          .update({ amount_units: seeded.toString() })
          .eq("game", b.game),
        b.lang,
      ).eq("day_utc", today);
    } catch (e) {
      console.error(`pot mirror failed for ${b.label}:`, e);
    }
  }

  // Per-language Telegram is gone — the GET handler now sends a single
  // consolidated summary (winners + skips for both EN and ES) after
  // both langs settle. Returning the full skip stats so the message
  // builder can render them.
  return {
    status: "settled",
    closed: { day: prevDay, winner, winnerScore, rolledTx },
    skipped: skipped.map((s) =>
      s.flag.flagged && s.flag.reason === "heuristic"
        ? {
            player: s.player,
            score: s.score,
            reason: "heuristic" as const,
            correctRate: s.flag.correctRate,
            p50ms: s.flag.p50ms,
            sampleSize: s.flag.sampleSize,
            relSpread: s.flag.relSpread,
          }
        : {
            player: s.player,
            score: s.score,
            reason: "blacklist" as const,
          },
    ),
    opened: today,
    day_number: lastPot.day_number + 1,
  };
}

async function rollDayOnChain(
  gameId: number,
  winner: string | null,
): Promise<string | null> {
  const pk = process.env.OPERATOR_PRIVATE_KEY;
  if (!pk) return null;
  if (POT_ADDRESS === zeroAddress) return null;

  try {
    const account = privateKeyToAccount(
      (pk.startsWith("0x") ? pk : `0x${pk}`) as Hex,
    );
    const walletClient = createWalletClient({
      account,
      chain: celo,
      transport: CELO_TRANSPORT,
    });

    const hash = await walletClient.writeContract({
      address: POT_ADDRESS,
      abi: FREAKING_POT_ABI,
      functionName: "rollDay",
      args: [BigInt(gameId), (winner ?? zeroAddress) as Hex],
    });
    const receipt = await celoClient.waitForTransactionReceipt({ hash });
    // viem's writeContract doesn't throw on on-chain revert (only on
    // simulation/broadcast failures), so the receipt status is the
    // only reliable signal that rollDay actually advanced chain state.
    // Without this check, a reverted rollDay (e.g. AlreadyRolled from
    // a duplicate cron invocation) would return a hash, the caller
    // would treat rollDay as successful, and downstream BD writes would
    // get attributed to the wrong day_number.
    if (receipt.status !== "success") {
      console.error(
        `rollDay reverted on-chain for gameId=${gameId}, tx=${hash}`,
      );
      return null;
    }
    return hash;
  } catch (e) {
    console.error(`rollDay on-chain failed for gameId=${gameId}:`, e);
    return null;
  }
}
