import type { NextRequest } from "next/server";
import { createWalletClient, http, zeroAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { supabase, todayUtc } from "@/lib/supabase";
import { CELO_RPC_URL, POT_ADDRESS } from "@/lib/chain";
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
  const results: Record<string, LangResult> = {} as Record<string, LangResult>;

  for (const lang of ["en", "es"] as const) {
    const gameId = lang === "en" ? 1 : 2;
    results[lang] = await rollLang(lang, gameId, today);
  }

  // Single consolidated Telegram for both languages. Sent on every
  // settlement run (not only when bots were caught) so the operator
  // gets a daily heartbeat with winners + any new heuristic flags
  // attached. Per-lang messages were too fragmented and silent on
  // smooth days; one message gives the full picture.
  await sendSettlementSummary(results).catch(() => {});

  return Response.json({ today, results });
}

async function sendSettlementSummary(
  results: Record<"en" | "es", LangResult>,
): Promise<void> {
  const settledAny =
    (results.en.status === "settled" && results.en.closed.day) ||
    (results.es.status === "settled" && results.es.closed.day);
  if (!settledAny) return; // nothing meaningful happened (e.g. alreadyOpen)

  const day =
    (results.en.status === "settled" && results.en.closed.day) ||
    (results.es.status === "settled" && results.es.closed.day) ||
    "";

  const lines: string[] = [`🎲 *Settlement ${day}*`];

  for (const lang of ["en", "es"] as const) {
    const r = results[lang];
    if (r.status !== "settled") {
      lines.push("", `*${lang.toUpperCase()}* — ${r.reason}`);
      continue;
    }
    const c = r.closed;
    const winnerLine = c.winner
      ? `✅ Winner: \`${c.winner.slice(0, 6)}…${c.winner.slice(-4)}\` (score ${c.winnerScore})`
      : `⚠️ No clean winner — pot rolls forward.`;
    lines.push("", `*${lang.toUpperCase()} → ${c.day}*`, winnerLine);
    if (r.skipped.length > 0) {
      lines.push(`🆕 auto-flagged ${r.skipped.length} new bot(s):`);
      for (const s of r.skipped) {
        const stats =
          s.reason === "heuristic" &&
          s.correctRate !== undefined &&
          s.p50ms !== undefined &&
          s.sampleSize !== undefined
            ? `correct=${(s.correctRate * 100).toFixed(1)}%, p50=${s.p50ms}ms, n=${s.sampleSize}`
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
      }>;
      opened: string;
      day_number: number;
    }
  | { status: "skipped"; reason: string };

async function rollLang(
  lang: "en" | "es",
  gameId: number,
  today: string,
): Promise<LangResult> {
  if (!supabase) return { status: "skipped", reason: "no-db" };

  const { data: last } = await supabase
    .from("pots")
    .select("lang,day_utc,day_number,amount_units,closed,rolled_tx")
    .eq("lang", lang)
    .order("day_utc", { ascending: false })
    .limit(1)
    .maybeSingle();

  const lastPot = last as Pot | null;

  if (!lastPot) {
    await supabase.from("pots").insert({
      lang,
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
      let query = supabase
        .from("runs")
        .select("player,score,ended_at")
        .eq("lang", lang)
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
        const flag = await checkBotPlayer(player, supabase, botBlacklist);
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

    await supabase
      .from("pots")
      .update({
        closed: true,
        winner,
        winner_score: winnerScore,
      })
      .eq("lang", lang)
      .eq("day_utc", prevDay);

    if (winner && Number(lastPot.amount_units) > 0) {
      await supabase.from("wins").upsert(
        {
          lang,
          day_utc: prevDay,
          player: winner,
          amount_units: lastPot.amount_units,
          claimed: false,
        },
        { onConflict: "lang,day_utc,player" },
      );
    }
  }

  // Open today in the DB so plays can start funding it.
  await supabase.from("pots").insert({
    lang,
    day_utc: today,
    day_number: lastPot.day_number + 1,
    amount_units: 0,
    closed: false,
  });

  // On-chain rollDay. Skipped if already rolled (rolled_tx set) or if operator
  // key / contract address aren't configured yet.
  let rolledTx: string | null = lastPot.rolled_tx;
  if (!rolledTx) {
    rolledTx = await rollDayOnChain(gameId, winner);
    if (rolledTx) {
      await supabase
        .from("pots")
        .update({ rolled_tx: rolledTx })
        .eq("lang", lang)
        .eq("day_utc", prevDay);
    }
  }

  // Mirror today's pot amount (seed from treasury) from the contract.
  if (POT_ADDRESS !== zeroAddress) {
    try {
      const seeded = await readPotAmount(gameId, lastPot.day_number + 1);
      await supabase
        .from("pots")
        .update({ amount_units: seeded.toString() })
        .eq("lang", lang)
        .eq("day_utc", today);
    } catch (e) {
      console.error(`pot mirror failed for ${lang}:`, e);
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
      transport: http(CELO_RPC_URL),
    });

    const hash = await walletClient.writeContract({
      address: POT_ADDRESS,
      abi: FREAKING_POT_ABI,
      functionName: "rollDay",
      args: [BigInt(gameId), (winner ?? zeroAddress) as Hex],
    });
    await celoClient.waitForTransactionReceipt({ hash });
    return hash;
  } catch (e) {
    console.error(`rollDay on-chain failed for gameId=${gameId}:`, e);
    return null;
  }
}
