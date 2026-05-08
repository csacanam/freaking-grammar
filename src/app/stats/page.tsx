// Live build-in-public stats. All numbers come from supabase + a few
// on-chain reads (current pots, treasury, operator CELO). No PostHog
// or web analytics yet — that's the next phase if/when we decide
// visitor-funnel data is worth the dependency. Public on purpose:
// the whole point is showing the room what the game looks like.

import { headers } from "next/headers";
import { erc20Abi, isAddressEqual, zeroAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { supabase, TOKEN_DECIMALS, todayUtc } from "@/lib/supabase";
import { fmtUSD } from "@/lib/format";
import { BackLink } from "@/components/BackLink";
import { PlaysChart } from "@/components/PlaysChart";
import {
  celoClient,
  FREAKING_POT_ABI,
  readTreasuryState,
} from "@/lib/onchain";
import { POT_ADDRESS } from "@/lib/chain";
import {
  fetchPostHogStats,
  countryFlag,
  type PostHogStats,
} from "@/lib/posthog-server";
import { dict, type Strings } from "@/lib/i18n";

export const dynamic = "force-dynamic";

const ENTRY_FEE_USD = 0.1;
const PROTOCOL_BPS = 2000; // 20%
const PROTOCOL_CUT_USD = (ENTRY_FEE_USD * PROTOCOL_BPS) / 10_000;

type Lang = "en" | "es";

// Three games today (Grammar EN, Grammar ES, Math); easy to extend with
// the next launch by adding a row here. Anything game-specific in the
// page reads off this list — tile labels, accent colors, contract IDs,
// the column order in the by-game table.
type GameKey = "grammar-en" | "grammar-es" | "math";

const GAMES: Array<{
  key: GameKey;
  label: string;
  contractId: number;
  game: "grammar" | "math";
  lang: Lang | null;
  accent: string;
}> = [
  { key: "grammar-en", label: "Grammar EN", contractId: 1, game: "grammar", lang: "en", accent: "bg-yellow/40" },
  { key: "grammar-es", label: "Grammar ES", contractId: 2, game: "grammar", lang: "es", accent: "bg-purple/20" },
  { key: "math",       label: "Math",       contractId: 3, game: "math",    lang: null, accent: "bg-pink/20" },
];

// Map a row from runs/wins/pots to its GameKey. Defensive: old rows
// (pre multi-game migration) have game=null but a non-null lang, so
// fall back to lang-based matching when game is missing. New Math rows
// use game='math' with lang=null.
function gameKeyOf(row: {
  game?: string | null;
  lang: string | null;
}): GameKey | null {
  if (row.game === "math") return "math";
  if (row.lang === "en") return "grammar-en";
  if (row.lang === "es") return "grammar-es";
  return null;
}

function emptyByGame(): ByGame {
  return {
    "grammar-en": { plays: 0, paid: 0, players: 0, revenueUSD: 0, distributedUSD: 0 },
    "grammar-es": { plays: 0, paid: 0, players: 0, revenueUSD: 0, distributedUSD: 0 },
    "math":       { plays: 0, paid: 0, players: 0, revenueUSD: 0, distributedUSD: 0 },
  };
}

type ByGame = Record<
  GameKey,
  {
    plays: number;
    paid: number;
    players: number;
    revenueUSD: number;
    distributedUSD: number;
  }
>;

type GameTodayTile = {
  key: GameKey;
  label: string;
  potUSDT: number;
  topScore: number | null;
  accent: string;
};

type GameTreasuryTile = {
  key: GameKey;
  label: string;
  treasuryUSDT: number;
  treasuryDays: number;
  accent: string;
};

type Stats = {
  today: {
    dau: number;
    plays: number;
    paid: number;
    free: number;
    games: GameTodayTile[];
    newSignups: number;
  };
  players: {
    total: number;
    last7d: number;
    last30d: number;
    wau: number;
    mau: number;
    distribution: Array<{ label: string; count: number }>;
    retentionDay2: { cohort: number; returned: number; pct: number };
    retentionDay7: { cohort: number; returned: number; pct: number };
    paidConversionPct: number;
  };
  plays: {
    total: number;
    paid: number;
    free: number;
    avgScore: number;
    perDay: Array<{ date: string; count: number }>;
    byGame: ByGame;
  };
  economy: {
    revenueUSD: number;
    distributedUSD: number;
    games: GameTreasuryTile[];
    biggestPotUSD: number;
    operatorCELO: number;
    daysClosed: number;
  };
  sponsors: Array<{
    name: string;
    tokenSymbol: string;
    balance: number;
    dailyPerGame: number;
    gamesCount: number;
    daysLeft: number;
    paidOut: number;
  }>;
  onchain: {
    totalTxs: number;
    plays: number;
    rollDays: number;
    welcomeAirdrops: number;
    sponsorAirdrops: number;
    claims: number;
    activeAddresses: number;
    daysOnChain: number;
    usdtIn: number;
    usdtOut: number;
    potAddress: string;
    operatorAddress: string | null;
    contractGasCELO: number; // total CELO burned on txs to the pot contract
    contractGasTxs: number;  // sample size for the gas figure (Blockscout-paginated)
  };
  posthog: PostHogStats | null;
};

async function loadStats(): Promise<Stats | null> {
  if (!supabase) return null;

  const today = todayUtc();
  const cutoff7 = daysAgo(today, 7);
  const cutoff30 = daysAgo(today, 30);

  const [
    { data: runsData },
    { data: winsData },
    { data: potsData },
    { data: airdropsData },
    { data: sponsorPayoutsData },
  ] = await Promise.all([
    supabase
      .from("runs")
      .select("lang,game,player,was_free,day_utc,score,paid_tx_hash")
      .eq("status", "finished"),
    supabase.from("wins").select("lang,game,amount_units,claim_tx"),
    supabase
      .from("pots")
      .select("lang,game,amount_units,closed,day_utc,rolled_tx"),
    supabase.from("welcome_airdrops").select("created_at,tx_hash"),
    supabase.from("sponsor_payouts").select("airdrop_tx_hash"),
  ]);

  const runs = (runsData ?? []) as Array<{
    lang: Lang | null;
    game: string | null;
    player: string;
    was_free: boolean;
    day_utc: string;
    score: number;
    paid_tx_hash: string | null;
  }>;
  const wins = (winsData ?? []) as Array<{
    lang: Lang | null;
    game: string | null;
    amount_units: string | number;
    claim_tx: string | null;
  }>;
  const pots = (potsData ?? []) as Array<{
    lang: Lang | null;
    game: string | null;
    amount_units: string | number;
    closed: boolean;
    day_utc: string;
    rolled_tx: string | null;
  }>;
  const airdrops = (airdropsData ?? []) as Array<{
    created_at: string;
    tx_hash: string | null;
  }>;
  const sponsorPayouts = (sponsorPayoutsData ?? []) as Array<{
    airdrop_tx_hash: string | null;
  }>;

  // ------------------------------------------------------- TODAY
  const todayRuns = runs.filter((r) => r.day_utc === today);
  const todayPlayers = new Set(todayRuns.map((r) => r.player));
  const todayPaid = todayRuns.filter((r) => !r.was_free).length;
  const todayFree = todayRuns.length - todayPaid;
  const newSignupsToday = airdrops.filter(
    (a) => a.tx_hash && a.created_at.slice(0, 10) === today,
  ).length;

  // Per-game top score for today, keyed by GameKey so the tile loop
  // below can look it up in O(1) regardless of how many games we add.
  const todayTopByGame = new Map<GameKey, number>();
  for (const r of todayRuns) {
    const k = gameKeyOf(r);
    if (!k) continue;
    const cur = todayTopByGame.get(k);
    if (cur === undefined || r.score > cur) todayTopByGame.set(k, r.score);
  }

  // -------------------------------------------------- ON-CHAIN POTS
  // Read pot/treasury for every game in the GAMES list so adding the
  // next launch is a one-line change up top, not surgery here.
  const [perGamePotUSDT, perGameTreasury, operatorCELO, contractGas] =
    await Promise.all([
      Promise.all(GAMES.map((g) => readCurrentPotUSD(g.contractId))),
      Promise.all(GAMES.map((g) => safeTreasury(g.contractId))),
      readOperatorCELO(),
      readContractGas(),
    ]);

  const todayGameTiles: GameTodayTile[] = GAMES.map((g, i) => ({
    key: g.key,
    label: g.label,
    potUSDT: perGamePotUSDT[i],
    topScore: todayTopByGame.get(g.key) ?? null,
    accent: g.accent,
  }));
  const economyGameTiles: GameTreasuryTile[] = GAMES.map((g, i) => ({
    key: g.key,
    label: g.label,
    treasuryUSDT: perGameTreasury[i].usdt,
    treasuryDays: perGameTreasury[i].days,
    accent: g.accent,
  }));

  // ---------------------------------------------------- PLAYERS
  const allPlayers = new Set(runs.map((r) => r.player));
  const last7Players = new Set(
    runs.filter((r) => r.day_utc >= cutoff7).map((r) => r.player),
  );
  const last30Players = new Set(
    runs.filter((r) => r.day_utc >= cutoff30).map((r) => r.player),
  );

  const playsByPlayer = new Map<string, number>();
  const paidByPlayer = new Map<string, number>();
  const daysByPlayer = new Map<string, Set<string>>();
  const firstDayByPlayer = new Map<string, string>();
  for (const r of runs) {
    playsByPlayer.set(r.player, (playsByPlayer.get(r.player) ?? 0) + 1);
    if (!r.was_free) {
      paidByPlayer.set(r.player, (paidByPlayer.get(r.player) ?? 0) + 1);
    }
    if (!daysByPlayer.has(r.player)) daysByPlayer.set(r.player, new Set());
    daysByPlayer.get(r.player)!.add(r.day_utc);
    const cur = firstDayByPlayer.get(r.player);
    if (!cur || r.day_utc < cur) firstDayByPlayer.set(r.player, r.day_utc);
  }

  const distBuckets = { "1": 0, "2": 0, "3-5": 0, "6-10": 0, "11+": 0 };
  for (const c of playsByPlayer.values()) {
    if (c === 1) distBuckets["1"]++;
    else if (c === 2) distBuckets["2"]++;
    else if (c <= 5) distBuckets["3-5"]++;
    else if (c <= 10) distBuckets["6-10"]++;
    else distBuckets["11+"]++;
  }

  // Retention: of players whose FIRST play was at least N days ago, how
  // many also played on (first-day + N)?
  function retention(n: number) {
    let cohort = 0;
    let returned = 0;
    const window = daysAgo(today, n);
    for (const [player, firstDay] of firstDayByPlayer) {
      if (firstDay > window) continue; // not enough time has passed
      cohort++;
      const target = daysAgo(firstDay, -n); // firstDay + n
      if (daysByPlayer.get(player)!.has(target)) returned++;
    }
    const pct = cohort > 0 ? (returned / cohort) * 100 : 0;
    return { cohort, returned, pct };
  }
  const retentionDay2 = retention(1); // day 1 → day 2 = 1 day later
  const retentionDay7 = retention(7);

  const paidConversionPct =
    allPlayers.size > 0
      ? (paidByPlayer.size / allPlayers.size) * 100
      : 0;

  // ------------------------------------------------------ PLAYS
  const totalPaid = runs.filter((r) => !r.was_free).length;
  const totalFree = runs.length - totalPaid;
  const avgScore =
    runs.length > 0
      ? runs.reduce((s, r) => s + r.score, 0) / runs.length
      : 0;

  // Last 30 days bar chart, oldest → newest
  const days30: string[] = [];
  for (let i = 29; i >= 0; i--) days30.push(daysAgo(today, i));
  const playsByDay = new Map<string, number>();
  for (const r of runs) {
    if (r.day_utc < days30[0]) continue;
    playsByDay.set(r.day_utc, (playsByDay.get(r.day_utc) ?? 0) + 1);
  }
  const perDay = days30.map((d) => ({
    date: d,
    count: playsByDay.get(d) ?? 0,
  }));

  // ----------------------------------------------- BY-GAME TABLE
  const byGame: ByGame = emptyByGame();
  const playersByGame: Record<GameKey, Set<string>> = {
    "grammar-en": new Set(),
    "grammar-es": new Set(),
    "math": new Set(),
  };
  for (const r of runs) {
    const k = gameKeyOf(r);
    if (!k) continue;
    byGame[k].plays++;
    playersByGame[k].add(r.player);
    if (!r.was_free) byGame[k].paid++;
  }
  for (const g of GAMES) {
    byGame[g.key].players = playersByGame[g.key].size;
    byGame[g.key].revenueUSD = byGame[g.key].paid * PROTOCOL_CUT_USD;
  }
  for (const w of wins) {
    const k = gameKeyOf(w);
    if (!k) continue;
    byGame[k].distributedUSD += Number(w.amount_units) / TOKEN_DECIMALS;
  }

  // ------------------------------------------------ ECONOMY ROLLUP
  let biggestPotUSD = 0;
  let daysClosed = 0;
  for (const p of pots) {
    if (!p.closed) continue;
    daysClosed++;
    const usd = Number(p.amount_units) / TOKEN_DECIMALS;
    if (usd > biggestPotUSD) biggestPotUSD = usd;
  }
  const totalDistributedUSD = wins.reduce(
    (s, w) => s + Number(w.amount_units) / TOKEN_DECIMALS,
    0,
  );
  const revenueUSD = totalPaid * PROTOCOL_CUT_USD;

  // ---------------------------------------------------- ON-CHAIN
  // Each kind of operator/user tx leaves a hash in our DB. Counting
  // them gives a faithful "activity on Celo" picture without needing
  // to spin up The Graph or replay receipts. Free plays still call
  // the contract — they're just charged 0 USDT — so we count every
  // run with a tx_hash, not just paid ones.
  const playsTxCount = runs.filter((r) => !!r.paid_tx_hash).length;
  const rollDaysCount = pots.filter((p) => !!p.rolled_tx).length;
  const welcomeAirdropsCount = airdrops.filter((a) => !!a.tx_hash).length;
  const sponsorAirdropsCount = sponsorPayouts.filter(
    (s) => !!s.airdrop_tx_hash,
  ).length;
  const claimsCount = wins.filter((w) => !!w.claim_tx).length;
  const totalTxs =
    playsTxCount +
    rollDaysCount +
    welcomeAirdropsCount +
    sponsorAirdropsCount +
    claimsCount;
  // USDT in: every paid play moves the entry fee through the contract.
  // Free plays don't touch USDT.
  const usdtIn = totalPaid * ENTRY_FEE_USD;
  const usdtOut = totalDistributedUSD;
  // Days on-chain: from earliest finished run to today (inclusive). If
  // there are no runs, default to 0.
  const earliestDay = runs.length
    ? runs.reduce((min, r) => (r.day_utc < min ? r.day_utc : min), today)
    : today;
  const daysOnChain = runs.length
    ? Math.max(1, daysBetween(earliestDay, today) + 1)
    : 0;
  const operatorAddrPrint = await getOperatorAddressOrNull();

  // ---------------------------------------------------- SPONSORS
  const sponsors = await loadSponsors();

  // ---------------------------------------------------- POSTHOG
  // Optional: only renders if POSTHOG_PROJECT_ID + POSTHOG_PERSONAL_API_KEY
  // are configured. fetchPostHogStats handles its own caching (1h) and
  // gracefully returns null on auth/network failure.
  const posthog = await fetchPostHogStats();

  return {
    today: {
      dau: todayPlayers.size,
      plays: todayRuns.length,
      paid: todayPaid,
      free: todayFree,
      games: todayGameTiles,
      newSignups: newSignupsToday,
    },
    players: {
      total: allPlayers.size,
      last7d: last7Players.size,
      last30d: last30Players.size,
      wau: last7Players.size,
      mau: last30Players.size,
      distribution: [
        { label: "1 play", count: distBuckets["1"] },
        { label: "2 plays", count: distBuckets["2"] },
        { label: "3-5 plays", count: distBuckets["3-5"] },
        { label: "6-10 plays", count: distBuckets["6-10"] },
        { label: "11+ plays", count: distBuckets["11+"] },
      ],
      retentionDay2,
      retentionDay7,
      paidConversionPct,
    },
    plays: {
      total: runs.length,
      paid: totalPaid,
      free: totalFree,
      avgScore,
      perDay,
      byGame,
    },
    economy: {
      revenueUSD,
      distributedUSD: totalDistributedUSD,
      games: economyGameTiles,
      biggestPotUSD,
      operatorCELO,
      daysClosed,
    },
    sponsors,
    posthog,
    onchain: {
      totalTxs,
      plays: playsTxCount,
      rollDays: rollDaysCount,
      welcomeAirdrops: welcomeAirdropsCount,
      sponsorAirdrops: sponsorAirdropsCount,
      claims: claimsCount,
      activeAddresses: allPlayers.size,
      daysOnChain,
      usdtIn,
      usdtOut,
      potAddress: POT_ADDRESS.toLowerCase(),
      operatorAddress: operatorAddrPrint?.toLowerCase() ?? null,
      contractGasCELO: contractGas.celo,
      contractGasTxs: contractGas.txs,
    },
  };
}

// --------------------------------------------------------- helpers

function daysAgo(yyyymmdd: string, n: number): string {
  const d = new Date(yyyymmdd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function daysBetween(fromYmd: string, toYmd: string): number {
  const from = new Date(fromYmd + "T00:00:00Z").getTime();
  const to = new Date(toYmd + "T00:00:00Z").getTime();
  return Math.max(0, Math.round((to - from) / 86400000));
}

async function readCurrentPotUSD(gameId: number): Promise<number> {
  if (isAddressEqual(POT_ADDRESS, zeroAddress)) return 0;
  try {
    const day = (await celoClient.readContract({
      address: POT_ADDRESS,
      abi: FREAKING_POT_ABI,
      functionName: "currentDay",
      args: [BigInt(gameId)],
    })) as bigint;
    const amount = (await celoClient.readContract({
      address: POT_ADDRESS,
      abi: FREAKING_POT_ABI,
      functionName: "viewPot",
      args: [BigInt(gameId), day],
    })) as bigint;
    return Number(amount) / TOKEN_DECIMALS;
  } catch {
    return 0;
  }
}

async function safeTreasury(
  gameId: number,
): Promise<{ usdt: number; days: number }> {
  if (isAddressEqual(POT_ADDRESS, zeroAddress)) {
    return { usdt: 0, days: 0 };
  }
  try {
    const { treasury, dailySeed } = await readTreasuryState(gameId);
    const usdt = Number(treasury) / TOKEN_DECIMALS;
    const seed = Number(dailySeed) / TOKEN_DECIMALS;
    const days = seed > 0 ? usdt / seed : 0;
    return { usdt, days };
  } catch {
    return { usdt: 0, days: 0 };
  }
}

async function readOperatorCELO(): Promise<number> {
  const pk = process.env.OPERATOR_PRIVATE_KEY;
  if (!pk) return 0;
  try {
    const account = privateKeyToAccount(
      (pk.startsWith("0x") ? pk : `0x${pk}`) as Hex,
    );
    const wei = await celoClient.getBalance({ address: account.address });
    return Number(wei) / 1e18;
  } catch {
    return 0;
  }
}

// Total CELO burned as gas across every transaction sent TO the pot
// contract — plays, rollDays, fundTreasuries, claims, sponsorPots,
// etc. This is the protocol-effort metric Talent Protocol exposes
// publicly: "this many actual on-chain calls happened, costing this
// much network gas". Source: Blockscout's v2 REST API (no key needed
// on Celo); paginated, capped at 50 pages × 50 items so a runaway
// chatty contract can't blow up the request.
async function readContractGas(): Promise<{ celo: number; txs: number }> {
  if (isAddressEqual(POT_ADDRESS, zeroAddress)) return { celo: 0, txs: 0 };
  const BS = "https://celo.blockscout.com/api/v2";
  const MAX_PAGES = 50;
  let totalWei = 0n;
  let txs = 0;
  let cursor: string | null = `${BS}/addresses/${POT_ADDRESS}/transactions?filter=to`;
  for (let page = 0; page < MAX_PAGES && cursor; page++) {
    try {
      const res = await fetch(cursor, {
        next: { revalidate: 3600 },
        headers: { accept: "application/json" },
      });
      if (!res.ok) break;
      const j = (await res.json()) as {
        items?: Array<{
          gas_used?: string | number | null;
          gas_price?: string | number | null;
          status?: string;
        }>;
        next_page_params?: Record<string, string | number> | null;
      };
      for (const t of j.items ?? []) {
        const used = BigInt(t.gas_used ?? "0");
        const price = BigInt(t.gas_price ?? "0");
        totalWei += used * price;
        txs++;
      }
      const npp = j.next_page_params;
      cursor = npp
        ? `${BS}/addresses/${POT_ADDRESS}/transactions?filter=to&${new URLSearchParams(
            Object.fromEntries(Object.entries(npp).map(([k, v]) => [k, String(v)])),
          ).toString()}`
        : null;
    } catch {
      break; // upstream flaky; return what we summed so far
    }
  }
  return { celo: Number(totalWei) / 1e18, txs };
}

async function loadSponsors(): Promise<Stats["sponsors"]> {
  if (!supabase) return [];
  type Row = {
    id: string;
    name: string;
    token_address: string;
    token_symbol: string;
    token_decimals: number;
    games: string[];
    daily_amount_per_game_units: string;
    total_budget_units: string;
  };
  const { data: campaignsData } = await supabase
    .from("sponsor_campaigns")
    .select(
      "id,name,token_address,token_symbol,token_decimals,games,daily_amount_per_game_units::text,total_budget_units::text",
    )
    .eq("active", true);
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

  const operatorAddr = await getOperatorAddressOrNull();
  const balances = new Map<string, bigint>();

  const out: Stats["sponsors"] = [];
  for (const c of campaigns) {
    let balanceRaw: bigint = 0n;
    if (operatorAddr) {
      const key = c.token_address.toLowerCase();
      let b = balances.get(key);
      if (b === undefined) {
        try {
          b = (await celoClient.readContract({
            address: c.token_address as `0x${string}`,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [operatorAddr],
          })) as bigint;
          balances.set(key, b);
        } catch {
          b = 0n;
        }
      }
      balanceRaw = b;
    }
    const dailyRaw = BigInt(c.daily_amount_per_game_units);
    const totalRaw = BigInt(c.total_budget_units);
    const spentRaw = spentByCampaign.get(c.id) ?? 0n;
    const remainingBudgetRaw = totalRaw - spentRaw;
    const dailyPerDayRaw = dailyRaw * BigInt(c.games.length);
    const factor = 10 ** c.token_decimals;
    const balance = Number(balanceRaw) / factor;
    const dailyPerGame = Number(dailyRaw) / factor;
    const dailyPerDay = Number(dailyPerDayRaw) / factor;
    const remainingBudget = Number(remainingBudgetRaw) / factor;
    const walletDays =
      dailyPerDay > 0 ? Math.floor(balance / dailyPerDay) : 0;
    const budgetDays =
      dailyPerDay > 0 ? Math.floor(remainingBudget / dailyPerDay) : 0;
    out.push({
      name: c.name,
      tokenSymbol: c.token_symbol,
      balance,
      dailyPerGame,
      gamesCount: c.games.length,
      daysLeft: Math.min(walletDays, budgetDays),
      paidOut: Number(spentRaw) / factor,
    });
  }
  return out;
}

async function getOperatorAddressOrNull(): Promise<`0x${string}` | null> {
  const pk = process.env.OPERATOR_PRIVATE_KEY;
  if (!pk) return null;
  try {
    return privateKeyToAccount(
      (pk.startsWith("0x") ? pk : `0x${pk}`) as Hex,
    ).address;
  } catch {
    return null;
  }
}

// =============================================================== PAGE
// Locale picked from the request's Accept-Language header so a Spanish
// browser sees Spanish labels even though this is a server component
// (no useLang() available). Mirrors detectUiLang() on the client.
async function pickLang(): Promise<Lang> {
  const accept = (await headers()).get("accept-language") ?? "";
  return accept.toLowerCase().startsWith("es") ? "es" : "en";
}

const distLabel = (
  bucket: "1" | "2" | "3-5" | "6-10" | "11+",
  t: Strings,
): string => {
  switch (bucket) {
    case "1":
      return t.statsDistOne;
    case "2":
      return t.statsDistTwo;
    case "3-5":
      return t.statsDistThreeToFive;
    case "6-10":
      return t.statsDistSixToTen;
    case "11+":
      return t.statsDistElevenPlus;
  }
};

export default async function StatsPage() {
  const lang = await pickLang();
  const t = dict[lang];
  const stats = await loadStats();

  return (
    <div className="flex-1 flex flex-col px-5 pt-6 pb-10 max-w-3xl mx-auto w-full gap-5">
      <header className="flex flex-col gap-2">
        <BackLink href="/" />
        <h1 className="font-display text-4xl tracking-wider">{t.statsHeading}</h1>
        <p className="text-xs font-mono text-muted">
          {t.statsLiveRefresh}
        </p>
      </header>

      {!stats ? (
        <div className="rounded-2xl bg-white border border-dashed border-black/10 p-8 text-center text-muted text-sm">
          {t.statsDbNotConfigured}
        </div>
      ) : (
        <>
          <SectionTitle>{t.statsSectionToday}</SectionTitle>
          <section className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Tile
              label={t.statsDau}
              value={stats.today.dau.toString()}
              accent="bg-teal/20"
            />
            <Tile
              label={t.statsPlaysToday}
              value={stats.today.plays.toString()}
              accent="bg-blue/10"
              hint={`${stats.today.paid} ${t.statsPaid} · ${stats.today.free} ${t.statsFree}`}
            />
            <Tile
              label={t.statsNewSignups}
              value={stats.today.newSignups.toString()}
              accent="bg-pink/20"
            />
            {stats.today.games.map((g) => (
              <Tile
                key={g.key}
                label={`${t.statsPot} · ${g.label}`}
                value={fmtUSD(g.potUSDT)}
                accent={g.accent}
                hint={
                  g.topScore !== null
                    ? `${t.statsTopScore} ${g.topScore}`
                    : t.statsNoPlaysYet
                }
              />
            ))}
            <Tile
              label={t.statsOperatorGas}
              value={`${stats.economy.operatorCELO.toFixed(3)} CELO`}
              accent="bg-orange/30"
              hint={`~${Math.floor(stats.economy.operatorCELO / 0.1)} ${t.statsAirdropsLeft}`}
            />
          </section>

          <SectionTitle>{t.statsSectionPlayers}</SectionTitle>
          <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Tile
              label={t.statsPlayersTotal}
              value={stats.players.total.toString()}
              accent="bg-teal/20"
            />
            <Tile
              label={t.statsWau}
              value={stats.players.wau.toString()}
              accent="bg-blue/10"
              hint={t.statsLast7Days}
            />
            <Tile
              label={t.statsMau}
              value={stats.players.mau.toString()}
              accent="bg-purple/20"
              hint={t.statsLast30Days}
            />
            <Tile
              label={t.statsPaidConversion}
              value={`${stats.players.paidConversionPct.toFixed(0)}%`}
              accent="bg-yellow/40"
              hint={t.statsEverPaid}
            />
          </section>

          <Card title={t.statsCardPlaysPerPlayer}>
            <div className="space-y-1">
              {stats.players.distribution.map((d) => (
                <DistributionRow
                  key={d.label}
                  label={distLabel(d.label as "1" | "2" | "3-5" | "6-10" | "11+", t)}
                  count={d.count}
                  total={stats.players.total}
                />
              ))}
            </div>
          </Card>

          <Card title={t.statsCardRetention}>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted font-display text-xs tracking-widest uppercase">
                  <th className="py-2">{t.statsRetentionCohort}</th>
                  <th className="py-2 text-right">{t.statsRetentionReturned}</th>
                  <th className="py-2 text-right">{t.statsRetentionRate}</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-black/5">
                  <td className="py-2">{t.statsRetentionDay1to2}</td>
                  <td className="py-2 text-right tabular-nums">
                    {stats.players.retentionDay2.returned} /{" "}
                    {stats.players.retentionDay2.cohort}
                  </td>
                  <td className="py-2 text-right tabular-nums font-display">
                    {stats.players.retentionDay2.pct.toFixed(0)}%
                  </td>
                </tr>
                <tr className="border-t border-black/5">
                  <td className="py-2">{t.statsRetentionDay1to7}</td>
                  <td className="py-2 text-right tabular-nums">
                    {stats.players.retentionDay7.returned} /{" "}
                    {stats.players.retentionDay7.cohort}
                  </td>
                  <td className="py-2 text-right tabular-nums font-display">
                    {stats.players.retentionDay7.pct.toFixed(0)}%
                  </td>
                </tr>
              </tbody>
            </table>
          </Card>

          <SectionTitle>{t.statsSectionPlays}</SectionTitle>
          <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Tile
              label={t.statsPlaysTotal}
              value={stats.plays.total.toString()}
              accent="bg-blue/10"
            />
            <Tile
              label={t.statsPlaysPaid}
              value={stats.plays.paid.toString()}
              accent="bg-teal/20"
            />
            <Tile
              label={t.statsPlaysFree}
              value={stats.plays.free.toString()}
              accent="bg-pink/20"
            />
            <Tile
              label={t.statsAvgScore}
              value={stats.plays.avgScore.toFixed(1)}
              accent="bg-yellow/40"
            />
          </section>

          <Card title={t.statsCardPlaysLast30}>
            <PlaysChart data={stats.plays.perDay} />
          </Card>

          <Card title={t.statsCardByGame}>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted font-display text-xs tracking-widest uppercase">
                  <th className="py-2">{t.statsLangColGame}</th>
                  <th className="py-2 text-right">{t.statsLangColPlays}</th>
                  <th className="py-2 text-right">{t.statsLangColPaid}</th>
                  <th className="py-2 text-right">{t.statsLangColPlayers}</th>
                  <th className="py-2 text-right">{t.statsLangColRevenue}</th>
                  <th className="py-2 text-right">{t.statsLangColPaidOut}</th>
                </tr>
              </thead>
              <tbody>
                {GAMES.map((g) => (
                  <tr key={g.key} className="border-t border-black/5">
                    <td className="py-2 font-display">{g.label}</td>
                    <td className="py-2 text-right tabular-nums">
                      {stats.plays.byGame[g.key].plays}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {stats.plays.byGame[g.key].paid}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {stats.plays.byGame[g.key].players}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {fmtUSD(stats.plays.byGame[g.key].revenueUSD)}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {fmtUSD(stats.plays.byGame[g.key].distributedUSD)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <SectionTitle>{t.statsSectionEconomy}</SectionTitle>
          <section className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Tile
              label={t.statsRevenue}
              value={fmtUSD(stats.economy.revenueUSD)}
              accent="bg-teal/20"
              hint={t.statsRevenueHint}
            />
            <Tile
              label={t.statsPaidOut}
              value={fmtUSD(stats.economy.distributedUSD)}
              accent="bg-yellow/40"
              hint={t.statsToWinners}
            />
            <Tile
              label={t.statsBiggestPot}
              value={fmtUSD(stats.economy.biggestPotUSD)}
              accent="bg-orange/30"
              hint={`${stats.economy.daysClosed} ${t.statsDaysClosed}`}
            />
            {stats.economy.games.map((g) => (
              <Tile
                key={g.key}
                label={`${t.statsTreasury} · ${g.label}`}
                value={fmtUSD(g.treasuryUSDT)}
                accent={g.accent}
                hint={`${g.treasuryDays.toFixed(0)}${t.statsRunwayDays}`}
              />
            ))}
          </section>

          <SectionTitle>{t.statsSectionOnchain}</SectionTitle>
          <section className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Tile
              label={t.statsTotalTx}
              value={stats.onchain.totalTxs.toLocaleString("en-US")}
              accent="bg-teal/20"
              hint={`${stats.onchain.activeAddresses} ${t.statsActiveAddresses}`}
            />
            <Tile
              label={t.statsPlaysOnchain}
              value={stats.onchain.plays.toLocaleString("en-US")}
              accent="bg-blue/10"
              hint={t.statsPlaysHitContract}
            />
            <Tile
              label={t.statsDaysOnchain}
              value={stats.onchain.daysOnChain.toString()}
              accent="bg-orange/30"
              hint={t.statsSinceFirstPlay}
            />
            <Tile
              label={t.statsUsdtIn}
              value={fmtUSD(stats.onchain.usdtIn)}
              accent="bg-yellow/40"
              hint={t.statsFromPaidEntries}
            />
            <Tile
              label={t.statsUsdtOut}
              value={fmtUSD(stats.onchain.usdtOut)}
              accent="bg-pink/20"
              hint={t.statsToWinners}
            />
            <Tile
              label={t.statsOperatorTxs}
              value={(
                stats.onchain.rollDays +
                stats.onchain.welcomeAirdrops +
                stats.onchain.sponsorAirdrops
              ).toLocaleString("en-US")}
              accent="bg-purple/20"
              hint={`${stats.onchain.welcomeAirdrops} ${t.statsAirdrops} · ${stats.onchain.rollDays} ${t.statsRolls}`}
            />
            <Tile
              label={t.statsContractGas}
              value={`${stats.onchain.contractGasCELO.toFixed(4)} CELO`}
              accent="bg-red/10"
              hint={`${stats.onchain.contractGasTxs.toLocaleString("en-US")} ${t.statsContractGasHint}`}
            />
          </section>

          <Card title={t.statsCardTxByType}>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted font-display text-xs tracking-widest uppercase">
                  <th className="py-2">{t.statsTxColType}</th>
                  <th className="py-2 text-right">{t.statsTxColCount}</th>
                  <th className="py-2 text-right">{t.statsTxColShare}</th>
                </tr>
              </thead>
              <tbody>
                {[
                  [t.statsTxRowPlays, stats.onchain.plays],
                  [t.statsTxRowRolls, stats.onchain.rollDays],
                  [t.statsTxRowWelcomeAirdrops, stats.onchain.welcomeAirdrops],
                  [t.statsTxRowSponsorAirdrops, stats.onchain.sponsorAirdrops],
                  [t.statsTxRowClaims, stats.onchain.claims],
                ].map(([label, count]) => {
                  const c = count as number;
                  const pct =
                    stats.onchain.totalTxs > 0
                      ? (c / stats.onchain.totalTxs) * 100
                      : 0;
                  return (
                    <tr key={label as string} className="border-t border-black/5">
                      <td className="py-2">{label}</td>
                      <td className="py-2 text-right tabular-nums">
                        {c.toLocaleString("en-US")}
                      </td>
                      <td className="py-2 text-right tabular-nums text-muted">
                        {pct.toFixed(1)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>

          <Card title={t.statsCardContracts}>
            <ul className="text-sm space-y-2">
              <ContractRow
                label={t.statsContractPot}
                address={stats.onchain.potAddress}
              />
              {stats.onchain.operatorAddress && (
                <ContractRow
                  label={t.statsContractOperator}
                  address={stats.onchain.operatorAddress}
                />
              )}
              <ContractRow
                label={t.statsContractUsdt}
                address="0x48065fbbe25f71c9282ddf5e1cd6d6a887483d5e"
              />
            </ul>
          </Card>

          {stats.sponsors.length > 0 && (
            <>
              <SectionTitle>{t.statsSectionSponsors}</SectionTitle>
              {stats.sponsors.map((s, i) => (
                <Card key={i} title={s.name}>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                    <KV
                      label={t.statsSponsorBalance}
                      value={`${formatAmount(s.balance)} ${s.tokenSymbol}`}
                    />
                    <KV
                      label={t.statsSponsorDailyPerGame}
                      value={`${formatAmount(s.dailyPerGame)} ${s.tokenSymbol}`}
                    />
                    <KV
                      label={t.statsSponsorPaidOut}
                      value={`${formatAmount(s.paidOut)} ${s.tokenSymbol}`}
                    />
                    <KV
                      label={t.statsSponsorRunway}
                      value={`${s.daysLeft}d ${t.statsSponsorDaysLeft}`}
                    />
                  </div>
                </Card>
              ))}
            </>
          )}

          {stats.posthog && stats.posthog.visitors30d > 0 && (
            <>
              <SectionTitle>{t.statsSectionWebAnalytics}</SectionTitle>
              <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Tile
                  label={t.statsVisitors7d}
                  value={stats.posthog.visitors7d.toLocaleString("en-US")}
                  accent="bg-teal/20"
                />
                <Tile
                  label={t.statsVisitors30d}
                  value={stats.posthog.visitors30d.toLocaleString("en-US")}
                  accent="bg-blue/10"
                />
                <Tile
                  label={t.statsSessions}
                  value={stats.posthog.sessions30d.toLocaleString("en-US")}
                  accent="bg-purple/20"
                  hint={t.statsLast30Days}
                />
                <Tile
                  label={t.statsConnectRate}
                  value={pctString(
                    stats.posthog.funnel.identified,
                    stats.posthog.funnel.visitors,
                  )}
                  accent="bg-yellow/40"
                  hint={t.statsOfVisitors}
                />
              </section>

              {stats.posthog.countries.length > 0 && (
                <Card title={t.statsCardTopCountries}>
                  <div className="space-y-1">
                    {stats.posthog.countries.map((c) => (
                      <DistributionRow
                        key={`${c.code ?? c.name}`}
                        label={`${countryFlag(c.code)} ${c.name}`.trim()}
                        count={c.visitors}
                        total={stats.posthog!.visitors30d}
                      />
                    ))}
                  </div>
                </Card>
              )}

              <Card title={t.statsCardFunnel}>
                <div className="space-y-1">
                  <DistributionRow
                    label={t.statsFunnelVisitors}
                    count={stats.posthog.funnel.visitors}
                    total={stats.posthog.funnel.visitors}
                  />
                  <DistributionRow
                    label={t.statsFunnelConnected}
                    count={stats.posthog.funnel.identified}
                    total={stats.posthog.funnel.visitors}
                  />
                  <DistributionRow
                    label={t.statsFunnelStarted}
                    count={stats.posthog.funnel.played}
                    total={stats.posthog.funnel.visitors}
                  />
                  <DistributionRow
                    label={t.statsFunnelFinished}
                    count={stats.posthog.funnel.finished}
                    total={stats.posthog.funnel.visitors}
                  />
                </div>
              </Card>

              {stats.posthog.devices.length > 0 && (
                <Card title={t.statsCardDevices}>
                  <div className="space-y-1">
                    {stats.posthog.devices.map((d) => (
                      <DistributionRow
                        key={d.device}
                        label={d.device}
                        count={d.visitors}
                        total={stats.posthog!.visitors30d}
                      />
                    ))}
                  </div>
                </Card>
              )}

              {stats.posthog.sources.length > 0 && (
                <Card title={t.statsCardTrafficSources}>
                  <div className="space-y-1">
                    {stats.posthog.sources.map((s) => (
                      <DistributionRow
                        key={s.source}
                        label={s.source}
                        count={s.visitors}
                        total={stats.posthog!.visitors30d}
                      />
                    ))}
                  </div>
                </Card>
              )}
            </>
          )}

          <section className="text-xs text-muted font-mono">
            <p>
              {t.statsEntryFee} {fmtUSD(ENTRY_FEE_USD)} · {t.statsProtocolCut} (
              {fmtUSD(PROTOCOL_CUT_USD)}{t.statsPerPlay})
            </p>
          </section>
        </>
      )}
    </div>
  );
}

// ============================================================ COMPONENTS

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-display text-2xl tracking-wider mt-3">{children}</h2>
  );
}

function Tile({
  label,
  value,
  accent,
  hint,
}: {
  label: string;
  value: string;
  accent: string;
  hint?: string;
}) {
  return (
    <div className={`${accent} rounded-2xl px-4 py-4`}>
      <div className="text-[10px] font-display tracking-widest uppercase text-muted leading-tight">
        {label}
      </div>
      <div className="font-display text-3xl mt-1 tabular-nums">{value}</div>
      {hint && (
        <div className="text-[11px] text-muted mt-1 leading-tight">{hint}</div>
      )}
    </div>
  );
}

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-3xl bg-white border border-black/5 p-5 shadow-[0_4px_0_0_rgba(0,0,0,0.04)]">
      <h3 className="font-display text-lg mb-3">{title}</h3>
      {children}
    </section>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-display tracking-widest uppercase text-muted">
        {label}
      </div>
      <div className="font-display text-lg tabular-nums">{value}</div>
    </div>
  );
}

function DistributionRow({
  label,
  count,
  total,
}: {
  label: string;
  count: number;
  total: number;
}) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div className="flex items-center gap-3 py-1.5 text-sm">
      <span className="w-20 text-muted">{label}</span>
      <div className="flex-1 h-3 bg-black/[0.04] rounded-full overflow-hidden">
        <div
          className="h-full bg-teal"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-20 text-right tabular-nums text-muted">
        {count}{" "}
        <span className="text-[11px]">({pct.toFixed(0)}%)</span>
      </span>
    </div>
  );
}

function ContractRow({
  label,
  address,
}: {
  label: string;
  address: string;
}) {
  const short = `${address.slice(0, 6)}…${address.slice(-4)}`;
  const explorer = `https://celoscan.io/address/${address}`;
  return (
    <li className="flex items-center justify-between gap-3">
      <span className="text-muted text-xs font-display tracking-widest uppercase">
        {label}
      </span>
      <a
        href={explorer}
        target="_blank"
        rel="noreferrer"
        className="font-mono text-xs text-teal hover:underline"
      >
        {short}
      </a>
    </li>
  );
}

function pctString(part: number, total: number): string {
  if (total <= 0) return "—";
  return `${((part / total) * 100).toFixed(0)}%`;
}

function formatAmount(n: number): string {
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (n >= 1) return n.toFixed(2);
  return n.toFixed(4);
}
