import type { NextRequest } from "next/server";
import { createWalletClient, http, zeroAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { supabase, todayUtc } from "@/lib/supabase";
import { CELO_RPC_URL, POT_ADDRESS } from "@/lib/chain";
import { FREAKING_POT_ABI, celoClient, readPotAmount } from "@/lib/onchain";

export const dynamic = "force-dynamic";

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
  const results: Record<string, unknown> = {};

  for (const lang of ["en", "es"] as const) {
    const gameId = lang === "en" ? 1 : 2;
    results[lang] = await rollLang(lang, gameId, today);
  }

  return Response.json({ today, results });
}

async function rollLang(lang: "en" | "es", gameId: number, today: string) {
  if (!supabase) return { skipped: "no-db" };

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
    return { opened: today, day_number: 1 };
  }

  if (lastPot.day_utc === today) {
    return { alreadyOpen: today };
  }

  const prevDay = lastPot.day_utc;
  let winner: string | null = null;
  let winnerScore: number | null = null;

  if (!lastPot.closed) {
    const { data: topRun } = await supabase
      .from("runs")
      .select("player,score,ended_at")
      .eq("lang", lang)
      .eq("day_utc", prevDay)
      .eq("status", "finished")
      .order("score", { ascending: false })
      .order("ended_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    const top = (topRun as { player: string; score: number } | null) ?? null;
    winner = top?.player ?? null;
    winnerScore = top?.score ?? null;

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

  return {
    closed: { day: prevDay, winner, winnerScore, rolledTx },
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
