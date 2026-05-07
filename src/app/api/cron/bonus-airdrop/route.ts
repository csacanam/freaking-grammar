// Runs ~5 min after the daily roll-day cron. For every active sponsor
// campaign, finds yesterday's winner per game and transfers the campaign
// token from the operator wallet to the winner's address. Carry-over is
// implicit: when there's no winner (no finished runs), we skip — the
// budget stays intact and the campaign effectively extends by a day.
// Idempotent via the unique(campaign_id, lang, day_utc) constraint on
// sponsor_payouts — a re-invocation detects the existing row and no-ops.

import type { NextRequest } from "next/server";
import {
  createWalletClient,
  erc20Abi,
  http,
  zeroAddress,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { supabase } from "@/lib/supabase";
import { CELO_RPC_URL } from "@/lib/chain";
import { celoClient } from "@/lib/onchain";

export const dynamic = "force-dynamic";
// Same reasoning as roll-day: each ERC-20 transfer + receipt wait is
// ~3-5s on Celo, and bonus-airdrop iterates up to lookback × langs ×
// campaigns transfers. 60s gives comfortable headroom; cold start
// alone can eat 10s.
export const maxDuration = 60;

type Campaign = {
  id: string;
  name: string;
  token_address: string;
  token_symbol: string;
  token_decimals: number;
  daily_amount_per_game_units: string | number;
  total_budget_units: string | number;
  games: string[];
  starts_at_utc: string;
  active: boolean;
};

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

  const pk = process.env.OPERATOR_PRIVATE_KEY;
  if (!pk) {
    return Response.json({ error: "no-operator-key" }, { status: 503 });
  }

  const account = privateKeyToAccount(
    (pk.startsWith("0x") ? pk : `0x${pk}`) as Hex,
  );
  const walletClient = createWalletClient({
    account,
    chain: celo,
    transport: http(CELO_RPC_URL),
  });

  // Scan the last N days so we recover from missed invocations. If the
  // roll-day cron was delayed past our own fire time, yesterday had no
  // winner yet when we first ran — without this backfill that day would
  // stay unpaid forever. The unique(campaign_id, lang, day_utc) index
  // guarantees idempotency: replayed runs no-op instead of double-paying.
  const LOOKBACK_DAYS = 3;
  const now = new Date();
  const dayKeys: string[] = [];
  for (let i = 1; i <= LOOKBACK_DAYS; i++) {
    const d = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i),
    );
    dayKeys.push(d.toISOString().slice(0, 10));
  }

  // ::text casts so BigInt() can parse numeric(78,0) columns losslessly.
  const { data: campaignsData } = await supabase
    .from("sponsor_campaigns")
    .select(
      "id,name,token_address,token_symbol,token_decimals,games,starts_at_utc,active,daily_amount_per_game_units::text,total_budget_units::text",
    )
    .eq("active", true)
    .lte("starts_at_utc", dayKeys[0]);
  const campaigns = (campaignsData ?? []) as Campaign[];

  const results: Array<Record<string, unknown>> = [];

  for (const c of campaigns) {
    // Spent-so-far per campaign for budget enforcement.
    const { data: spentData } = await supabase
      .from("sponsor_payouts")
      .select("amount_units::text")
      .eq("campaign_id", c.id);
    let spent = 0n;
    for (const row of (spentData ?? []) as Array<{
      amount_units: string | number;
    }>) {
      spent += BigInt(String(row.amount_units));
    }
    const budget = BigInt(String(c.total_budget_units));
    const daily = BigInt(String(c.daily_amount_per_game_units));

    for (const lang of c.games) {
      if (lang !== "en" && lang !== "es") continue;

      // Walk backward from most-recent day. Stops per-day on first success
      // or any of the skip conditions — we try *every* unpaid day in range.
      for (const dayKey of dayKeys) {
        if (dayKey < c.starts_at_utc) break; // campaign didn't exist yet

        // Idempotency: already paid?
        const { data: existing } = await supabase
          .from("sponsor_payouts")
          .select("id,airdrop_tx_hash")
          .eq("campaign_id", c.id)
          .eq("lang", lang)
          .eq("day_utc", dayKey)
          .maybeSingle();
        if (existing) continue;

        // Budget guard.
        if (spent + daily > budget) {
          results.push({
            campaign: c.name,
            lang,
            day: dayKey,
            skipped: "budget-exhausted",
          });
          break;
        }

        // Read the day's winner from `pots.winner` — the same address
        // roll-day chose AFTER running the bot filter. Querying `runs`
        // directly here would re-pick the raw top scorer and bypass the
        // blacklist + heuristic, exactly the bug that paid 8,000 COPm
        // to the 0xdead sybil on 2026-05-06 even though roll-day had
        // correctly settled the pot to a real human.
        const { data: potRow } = await supabase
          .from("pots")
          .select("winner,winner_score,closed")
          .eq("lang", lang)
          .eq("day_utc", dayKey)
          .maybeSingle();
        const pot = potRow as
          | { winner: string | null; winner_score: number | null; closed: boolean }
          | null;
        if (!pot || !pot.closed) {
          // Pot not settled yet — bonus-airdrop runs ~5 min after
          // roll-day, so this is rare; if it happens, the next
          // invocation will pick it up.
          continue;
        }
        if (!pot.winner) {
          // Pot closed but no clean winner (e.g., every candidate was
          // a flagged bot). Carry-over: don't spend, don't log.
          continue;
        }
        const winner = pot.winner;

        try {
          const hash = await walletClient.writeContract({
            address: c.token_address as `0x${string}`,
            abi: erc20Abi,
            functionName: "transfer",
            args: [winner as `0x${string}`, daily],
          });
          await celoClient.waitForTransactionReceipt({ hash });

          await supabase.from("sponsor_payouts").insert({
            campaign_id: c.id,
            lang,
            day_utc: dayKey,
            winner,
            amount_units: daily.toString(),
            airdrop_tx_hash: hash,
          });
          spent += daily;
          results.push({
            campaign: c.name,
            lang,
            day: dayKey,
            paid: {
              winner,
              amount: daily.toString(),
              txHash: hash,
            },
          });
        } catch (e) {
          console.error(
            `bonus-airdrop failed for campaign=${c.name} lang=${lang} day=${dayKey}:`,
            e,
          );
          results.push({
            campaign: c.name,
            lang,
            day: dayKey,
            error: (e as Error).message ?? "tx-failed",
          });
        }
      }
    }
  }

  void zeroAddress;

  return Response.json({ scannedDays: dayKeys, results });
}
