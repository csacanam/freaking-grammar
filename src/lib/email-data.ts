// Pulls the live EmailData payload (pot amounts, draw-ticket counts,
// active sponsor bonuses) that the daily-email templates need. Shared by
// both cron endpoints so the rendering logic stays pure string-formatting
// on top of a known shape.

import { erc20Abi } from "viem";
import { celoClient, FREAKING_POT_ABI } from "./onchain";
import { POT_ADDRESS } from "./chain";
import { supabase, TOKEN_DECIMALS, todayUtc } from "./supabase";
import { loadBotBlacklist } from "./bot-detection";
import { buildTicketEntries } from "./draw";
import type { EmailData, SponsorBonus } from "./email-templates";

const GAMES: Array<{ id: number; key: "en" | "es" | "math" }> = [
  { id: 1, key: "en" },
  { id: 2, key: "es" },
  { id: 3, key: "math" },
];

export async function fetchDailyEmailData(): Promise<EmailData> {
  const [potsByGame, ticketsByGame, sponsors] = await Promise.all([
    fetchPots(),
    fetchDrawTickets(),
    fetchActiveSponsors(),
  ]);

  return {
    pots: {
      en: { usdt: potsByGame.en, drawTickets: ticketsByGame.en },
      es: { usdt: potsByGame.es, drawTickets: ticketsByGame.es },
      math: { usdt: potsByGame.math, drawTickets: ticketsByGame.math },
    },
    sponsors,
  };
}

async function fetchPots(): Promise<{ en: number; es: number; math: number }> {
  const out = { en: 0, es: 0, math: 0 };
  await Promise.all(
    GAMES.map(async (g) => {
      try {
        const day = (await celoClient.readContract({
          address: POT_ADDRESS,
          abi: FREAKING_POT_ABI,
          functionName: "currentDay",
          args: [BigInt(g.id)],
        })) as bigint;
        const amount = (await celoClient.readContract({
          address: POT_ADDRESS,
          abi: FREAKING_POT_ABI,
          functionName: "viewPot",
          args: [BigInt(g.id), day],
        })) as bigint;
        out[g.key] = Number(amount) / TOKEN_DECIMALS;
      } catch (e) {
        console.warn(`fetchPots failed for ${g.key}:`, e);
      }
    }),
  );
  return out;
}

// Tickets bought so far today per game, under the exact settlement rules
// (src/lib/draw.ts): paid finished runs with score > 0, blacklist excluded,
// 1-3 tickets each by score. Same numbers the lobby shows.
async function fetchDrawTickets(): Promise<{
  en: number;
  es: number;
  math: number;
}> {
  const out = { en: 0, es: 0, math: 0 };
  if (!supabase) return out;
  const day = todayUtc();
  const blacklist = await loadBotBlacklist(supabase);
  const blacklistFilter =
    blacklist.size > 0
      ? `(${[...blacklist].map((p) => `"${p}"`).join(",")})`
      : null;
  await Promise.all(
    GAMES.map(async (g) => {
      // Math runs carry game='math' and lang=NULL; grammar runs are
      // uniquely identified by their lang.
      let q = supabase!
        .from("runs")
        .select("id,player,score")
        .eq("day_utc", day)
        .eq("status", "finished")
        .eq("was_free", false)
        .gt("score", 0)
        .limit(1000);
      q = g.key === "math" ? q.eq("game", "math") : q.eq("lang", g.key);
      if (blacklistFilter) q = q.not("player", "in", blacklistFilter);
      const { data } = await q;
      out[g.key] = buildTicketEntries(
        (data ?? []) as Array<{ id: string; player: string; score: number }>,
        g.id,
      ).length;
    }),
  );
  return out;
}

// Active sponsor campaigns available today. Mirrors the runway-guard
// logic in lobby/route: we skip campaigns whose budget is exhausted
// OR whose operator wallet can't cover today's commitment — promising
// a bonus we can't deliver is worse than not promising at all.
async function fetchActiveSponsors(): Promise<SponsorBonus[]> {
  if (!supabase) return [];

  type Row = {
    id: string;
    token_address: string;
    token_symbol: string;
    token_decimals: number;
    daily_amount_per_game_units: string;
    total_budget_units: string;
    games: string[];
  };
  const today = todayUtc();
  const { data: campaignsData } = await supabase
    .from("sponsor_campaigns")
    .select(
      "id,token_address,token_symbol,token_decimals,games,daily_amount_per_game_units::text,total_budget_units::text",
    )
    .eq("active", true)
    .lte("starts_at_utc", today);
  const campaigns = (campaignsData ?? []) as Row[];
  if (campaigns.length === 0) return [];

  const { data: spentData } = await supabase
    .from("sponsor_payouts")
    .select("campaign_id,amount_units::text")
    .in(
      "campaign_id",
      campaigns.map((c) => c.id),
    );
  const spentByCampaign = new Map<string, bigint>();
  for (const p of (spentData ?? []) as Array<{
    campaign_id: string;
    amount_units: string;
  }>) {
    const prev = spentByCampaign.get(p.campaign_id) ?? 0n;
    spentByCampaign.set(p.campaign_id, prev + BigInt(p.amount_units));
  }

  const operator = getOperatorAddress();
  const balanceByToken = new Map<string, bigint>();

  const out: SponsorBonus[] = [];
  for (const c of campaigns) {
    const daily = BigInt(c.daily_amount_per_game_units);
    const budget = BigInt(c.total_budget_units);
    const spent = spentByCampaign.get(c.id) ?? 0n;
    // Budget check: enough left for at least one more day across all games
    // it covers.
    const todayCommit = daily * BigInt(c.games.length);
    if (spent + todayCommit > budget) continue;

    if (operator) {
      const tokenKey = c.token_address.toLowerCase();
      let balance = balanceByToken.get(tokenKey);
      if (balance === undefined) {
        try {
          balance = (await celoClient.readContract({
            address: c.token_address as `0x${string}`,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [operator],
          })) as bigint;
          balanceByToken.set(tokenKey, balance);
        } catch {
          /* balance check is best-effort; fall through */
        }
      }
      if (balance !== undefined && balance < todayCommit) continue;
    }

    const gamesFiltered = c.games.filter(
      (g): g is "en" | "es" => g === "en" || g === "es",
    );
    out.push({
      games: gamesFiltered,
      tokenSymbol: c.token_symbol,
      amountPerGame: Number(daily) / 10 ** c.token_decimals,
    });
  }
  return out;
}

function getOperatorAddress(): `0x${string}` | null {
  const pk = process.env.OPERATOR_PRIVATE_KEY;
  if (!pk) return null;
  try {
    // Lazy import to keep the server-only dep out of any client bundle.
    const { privateKeyToAccount } = require("viem/accounts") as {
      privateKeyToAccount: (pk: `0x${string}`) => { address: `0x${string}` };
    };
    const hex = (pk.startsWith("0x") ? pk : `0x${pk}`) as `0x${string}`;
    return privateKeyToAccount(hex).address;
  } catch {
    return null;
  }
}
