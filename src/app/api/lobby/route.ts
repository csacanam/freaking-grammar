import type { NextRequest } from "next/server";
import { erc20Abi, isAddressEqual, zeroAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { gameIdFor, validateLang } from "@/lib/i18n";
import {
  supabase,
  todayUtc,
  nextUtcMidnightIso,
  TOKEN_DECIMALS,
} from "@/lib/supabase";
import { POT_ADDRESS } from "@/lib/chain";
import {
  celoClient,
  FREAKING_POT_ABI,
  readHasFreePlayToday,
} from "@/lib/onchain";
import { loadBotBlacklist } from "@/lib/bot-detection";

// Cache the operator address at module scope — it's derived from a stable
// env var and reused on every lobby fetch to validate sponsor balances.
let operatorAddrCache: `0x${string}` | null | undefined;
function getOperatorAddress(): `0x${string}` | null {
  if (operatorAddrCache !== undefined) return operatorAddrCache;
  const pk = process.env.OPERATOR_PRIVATE_KEY;
  if (!pk) {
    operatorAddrCache = null;
    return null;
  }
  operatorAddrCache = privateKeyToAccount(
    (pk.startsWith("0x") ? pk : `0x${pk}`) as Hex,
  ).address;
  return operatorAddrCache;
}

export const dynamic = "force-dynamic";

type LeaderboardRow = {
  rank: number;
  player: string;
  score: number;
  isMe?: boolean;
};

const MOCK_LEADERBOARD: LeaderboardRow[] = [
  { rank: 1, player: "0xa11ce00000000000000000000000000000001234", score: 47 },
  { rank: 2, player: "0xbead00000000000000000000000000000000c0ff", score: 41, isMe: true },
  { rank: 3, player: "0xcafe000000000000000000000000000000000f02", score: 38 },
  { rank: 4, player: "0xd00d0000000000000000000000000000000077a1", score: 33 },
  { rank: 5, player: "0xe5cape000000000000000000000000000000091bc", score: 29 },
  { rank: 6, player: "0xfade000000000000000000000000000000000044", score: 27 },
  { rank: 7, player: "0x0b01000000000000000000000000000000000018", score: 24 },
];

export async function GET(req: NextRequest) {
  const lang = validateLang(req.nextUrl.searchParams.get("lang"));
  const gameId = gameIdFor(lang);
  const player =
    req.nextUrl.searchParams.get("player")?.toLowerCase() || null;

  if (!supabase) {
    return Response.json({
      potUSD: 1.48,
      closesAtIso: nextUtcMidnightIso(),
      leaderboard: MOCK_LEADERBOARD.map((r) => ({
        ...r,
        isMe: player ? r.isMe : r.isMe,
      })),
      playerHasFreePlay: true,
    });
  }

  const day = todayUtc();

  // Pull the bot blacklist first so we can push the filter into the
  // leaderboard query. Without this, flagged wallets dominate the
  // live podium until daily settlement skips them — bad UX (real
  // players see "I can't compete" and bounce). Tabla `bot_wallets` is
  // tiny, so the extra round-trip is cheap.
  const blacklist = await loadBotBlacklist(supabase);
  const blacklistFilter =
    blacklist.size > 0
      ? `(${[...blacklist].map((p) => `"${p}"`).join(",")})`
      : null;

  let runsQuery = supabase
    .from("runs")
    .select("player,score,ended_at")
    .eq("lang", lang)
    .eq("day_utc", day)
    .eq("status", "finished")
    .order("score", { ascending: false })
    .order("ended_at", { ascending: true })
    .limit(200);
  if (blacklistFilter) {
    runsQuery = runsQuery.not("player", "in", blacklistFilter);
  }

  const [potRes, runsRes] = await Promise.all([
    supabase
      .from("pots")
      .select("amount_units,day_number")
      .eq("lang", lang)
      .eq("day_utc", day)
      .maybeSingle(),
    runsQuery,
  ]);

  // Prefer the live on-chain pot so sponsorPot / seedCurrentDay calls show up
  // immediately in the UI. Fall back to the DB mirror if the RPC hiccups or
  // the contract isn't deployed yet.
  let potUSD = potRes.data?.amount_units
    ? Number(potRes.data.amount_units) / TOKEN_DECIMALS
    : 0;
  if (!isAddressEqual(POT_ADDRESS, zeroAddress)) {
    try {
      const contractDay = (await celoClient.readContract({
        address: POT_ADDRESS,
        abi: FREAKING_POT_ABI,
        functionName: "currentDay",
        args: [BigInt(gameId)],
      })) as bigint;
      const onChainPot = (await celoClient.readContract({
        address: POT_ADDRESS,
        abi: FREAKING_POT_ABI,
        functionName: "viewPot",
        args: [BigInt(gameId), contractDay],
      })) as bigint;
      potUSD = Number(onChainPot) / TOKEN_DECIMALS;
    } catch {
      /* keep DB fallback */
    }
  }

  // Best run per player (results are pre-sorted score desc, ended_at asc).
  const bestByPlayer = new Map<string, number>();
  for (const r of (runsRes.data ?? []) as Array<{ player: string; score: number }>) {
    if (!bestByPlayer.has(r.player)) {
      bestByPlayer.set(r.player, r.score);
    }
  }
  const leaderboard: LeaderboardRow[] = [...bestByPlayer.entries()].map(
    ([p, score], i) => ({
      rank: i + 1,
      player: p,
      score,
      ...(player === p ? { isMe: true } : {}),
    }),
  );

  let playerHasFreePlay = true;
  if (player) {
    // On-chain is source of truth. Fall back to DB (only terminal runs count,
    // `open` rows from abandoned tabs don't burn the allowance) if the RPC
    // hiccups or the contract isn't deployed yet.
    if (!isAddressEqual(POT_ADDRESS, zeroAddress)) {
      try {
        playerHasFreePlay = await readHasFreePlayToday(
          gameId,
          player as `0x${string}`,
        );
      } catch {
        const { count } = await supabase
          .from("runs")
          .select("*", { count: "exact", head: true })
          .eq("lang", lang)
          .eq("day_utc", day)
          .eq("player", player)
          .neq("status", "open");
        playerHasFreePlay = (count ?? 0) === 0;
      }
    } else {
      const { count } = await supabase
        .from("runs")
        .select("*", { count: "exact", head: true })
        .eq("lang", lang)
        .eq("day_utc", day)
        .eq("player", player)
        .neq("status", "open");
      playerHasFreePlay = (count ?? 0) === 0;
    }
  }

  // Bonus campaigns active today for this game. These top up the USDT pot
  // with a separate ERC20 reward (e.g. COPm from Celo Colombia) that the
  // airdrop cron pays directly to the daily winner.
  type CampaignRow = {
    id: string;
    name: string;
    emoji: string | null;
    token_address: string;
    token_symbol: string;
    token_decimals: number;
    daily_amount_per_game_units: string | number;
    total_budget_units: string | number;
    starts_at_utc: string;
    games: string[];
  };
  const today = day;
  // Numeric(78,0) columns come back as text via ::text cast so BigInt() can
  // parse them losslessly — otherwise JSON.parse turns large values into
  // floats in scientific notation and BigInt("4e+21") throws.
  const { data: campaignsData } = await supabase
    .from("sponsor_campaigns")
    .select(
      "id,name,emoji,token_address,token_symbol,token_decimals,starts_at_utc,games,daily_amount_per_game_units::text,total_budget_units::text",
    )
    .eq("active", true)
    .lte("starts_at_utc", today);
  const campaigns = (campaignsData ?? []) as CampaignRow[];

  // Pull spent-so-far per campaign in one shot to compute remaining budget.
  const activeCampaigns = campaigns.filter((c) => c.games.includes(lang));
  const bonuses: {
    sponsor: string;
    emoji: string | null;
    amount: number;
    tokenSymbol: string;
  }[] = [];
  if (activeCampaigns.length > 0) {
    const { data: spentData } = await supabase
      .from("sponsor_payouts")
      .select("campaign_id,amount_units::text")
      .in(
        "campaign_id",
        activeCampaigns.map((c) => c.id),
      );
    const spentByCampaign = new Map<string, bigint>();
    for (const p of (spentData ?? []) as Array<{
      campaign_id: string;
      amount_units: string | number;
    }>) {
      const prev = spentByCampaign.get(p.campaign_id) ?? 0n;
      spentByCampaign.set(p.campaign_id, prev + BigInt(String(p.amount_units)));
    }

    // Per-request cache of on-chain balances so we don't repeat RPC reads
    // for the same token across multiple campaigns (unlikely today, but
    // future-proof).
    const operator = getOperatorAddress();
    const balanceByToken = new Map<string, bigint>();

    for (const c of activeCampaigns) {
      const daily = BigInt(String(c.daily_amount_per_game_units));
      const budget = BigInt(String(c.total_budget_units));
      const spent = spentByCampaign.get(c.id) ?? 0n;
      if (spent + daily > budget) continue; // budget exhausted

      // Honesty check: only surface the bonus if the operator wallet
      // actually holds enough to cover today's commitment across every
      // game this campaign covers. Prevents promising a payout we can't
      // deliver (e.g. the sponsor hasn't funded yet, or the wallet was
      // drained). If the RPC lookup fails, fall back to trusting the DB.
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
          } catch (e) {
            console.warn(
              `bonus balanceOf failed for ${c.name} (${c.token_symbol}); showing anyway:`,
              e,
            );
          }
        }
        if (balance !== undefined) {
          const dailyCommit = daily * BigInt(c.games.length);
          if (balance < dailyCommit) continue; // wallet can't cover today
        }
      }

      bonuses.push({
        sponsor: c.name,
        emoji: c.emoji,
        amount: Number(daily) / 10 ** c.token_decimals,
        tokenSymbol: c.token_symbol,
      });
    }
  }

  return Response.json({
    potUSD,
    closesAtIso: nextUtcMidnightIso(),
    leaderboard,
    playerHasFreePlay,
    bonuses,
  });
}
