import type { NextRequest } from "next/server";
import {
  createWalletClient,
  erc20Abi,
  isAddressEqual,
  maxUint256,
  parseEther,
  zeroAddress,
  type Hex,
} from "viem";
import { nonceManager, privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { CELO_TRANSPORT, POT_ADDRESS, STABLECOIN, ACTIVE_CHAIN } from "@/lib/chain";
import {
  FREAKING_POT_ABI,
  celoClient,
  readTreasuryState,
} from "@/lib/onchain";
import { supabase, TOKEN_DECIMALS } from "@/lib/supabase";
import { sendTelegramMessage } from "@/lib/telegram";

export const dynamic = "force-dynamic";

const GAMES = [
  { id: 1, key: "en", label: "EN" },
  { id: 2, key: "es", label: "ES" },
  { id: 3, key: "math", label: "MATH" },
] as const;

// Buffer we target per game when auto-funding. Anything below this gets
// priority; anything extra past both games' targets is split 50/50.
const TARGET_DAYS = 30n;
// Warn in the message if the operator wallet is running low on gas.
const LOW_CELO_WARN_WEI = parseEther("0.1");

type GameState = {
  id: number;
  key: string;
  label: string;
  treasuryUSD: number;
  seedUSD: number;
  days: number;
};

type Alloc = { gameId: number; amount: bigint };

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    return Response.json(
      { error: "telegram-not-configured" },
      { status: 503 },
    );
  }
  if (isAddressEqual(POT_ADDRESS, zeroAddress)) {
    return Response.json(
      { error: "contract-not-deployed" },
      { status: 503 },
    );
  }

  const operatorPk = process.env.OPERATOR_PRIVATE_KEY;

  // Attempt auto-fund from the operator's USDT balance before reading the
  // treasury state so the alert reflects the post-fund numbers.
  let fundReport: AutoFundReport = { ran: false };
  let gasWarn = false;
  if (operatorPk) {
    try {
      fundReport = await autoFund(operatorPk as Hex);
      if ("operatorCELO" in fundReport) {
        gasWarn = fundReport.operatorCELO < LOW_CELO_WARN_WEI;
      }
    } catch (e) {
      fundReport = {
        ran: true,
        error: (e as Error).message,
        operatorAddress: privateKeyToAccount(
          (operatorPk.startsWith("0x") ? operatorPk : `0x${operatorPk}`) as Hex,
        ).address,
      };
    }
  }

  // Forno is a load-balanced RPC — after a fundTreasury tx is mined, a
  // follow-up eth_call routed to a different node may still return the
  // pre-tx state for a beat. Pause briefly so the read below reflects the
  // freshly-funded treasury.
  if (
    fundReport.ran &&
    "txHashes" in fundReport &&
    fundReport.txHashes &&
    Object.keys(fundReport.txHashes).length > 0
  ) {
    await new Promise((r) => setTimeout(r, 2500));
  }

  const states: GameState[] = await Promise.all(
    GAMES.map(async (g) => {
      const { treasury, dailySeed } = await readTreasuryState(g.id);
      const treasuryUSD = Number(treasury) / TOKEN_DECIMALS;
      const seedUSD = Number(dailySeed) / TOKEN_DECIMALS;
      const days = seedUSD > 0 ? treasuryUSD / seedUSD : 0;
      return { ...g, treasuryUSD, seedUSD, days };
    }),
  );

  // Operator's balance for each sponsor campaign token so the alert catches
  // "Celo Colombia is about to run out of COPm" the same way it catches USDT
  // runway on the pots.
  const sponsorStates = operatorPk
    ? await readSponsorStates(
        privateKeyToAccount(
          (operatorPk.startsWith("0x") ? operatorPk : `0x${operatorPk}`) as Hex,
        ).address,
      )
    : [];

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin;
  const text = formatMessage({
    states,
    sponsorStates,
    fund: fundReport,
    gasWarn,
    baseUrl,
  });

  const sent = await sendTelegramMessage(text);
  return Response.json({
    sent,
    states,
    fund: serializeFund(fundReport),
  });
}

function serializeFund(f: AutoFundReport): unknown {
  if (!f.ran) return { ran: false };
  if ("error" in f)
    return { ran: true, error: f.error, operatorAddress: f.operatorAddress };
  return {
    ran: true,
    operatorAddress: f.operatorAddress,
    operatorUSDT: f.operatorUSDT.toString(),
    operatorCELO: f.operatorCELO.toString(),
    skipped: f.skipped,
    approveTx: f.approveTx,
    allocations: f.allocations?.map((a) => ({
      gameId: a.gameId,
      amount: a.amount.toString(),
    })),
    txHashes: f.txHashes,
    txErrors: f.txErrors,
  };
}

// --------------------------------------------------------------- auto-fund

type AutoFundReport =
  | { ran: false }
  | { ran: true; error: string; operatorAddress?: `0x${string}` }
  | {
      ran: true;
      operatorAddress: `0x${string}`;
      operatorUSDT: bigint;
      operatorCELO: bigint;
      skipped?: "no-balance";
      approveTx?: string;
      allocations?: Alloc[];
      txHashes?: Record<number, string>;
      txErrors?: Record<number, string>;
    };

async function autoFund(pkHex: Hex): Promise<AutoFundReport> {
  // nonceManager tracks the nonce locally across txs — Forno is
  // load-balanced, so asking a fresh node for the nonce after each mined
  // tx can return a stale count and get the next tx rejected.
  const account = privateKeyToAccount(
    (pkHex.startsWith("0x") ? pkHex : `0x${pkHex}`) as Hex,
    { nonceManager },
  );
  const walletClient = createWalletClient({
    account,
    chain: celo,
    transport: CELO_TRANSPORT,
  });
  const token = STABLECOIN[ACTIVE_CHAIN.id];

  const [usdtBalance, celoBalance] = await Promise.all([
    celoClient.readContract({
      address: token.address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [account.address],
    }) as Promise<bigint>,
    celoClient.getBalance({ address: account.address }),
  ]);

  if (usdtBalance === 0n) {
    return {
      ran: true,
      operatorAddress: account.address,
      skipped: "no-balance",
      operatorUSDT: 0n,
      operatorCELO: celoBalance,
    };
  }

  const allowance = (await celoClient.readContract({
    address: token.address,
    abi: erc20Abi,
    functionName: "allowance",
    args: [account.address, POT_ADDRESS],
  })) as bigint;

  let approveTx: string | undefined;
  if (allowance < usdtBalance) {
    const hash = await walletClient.writeContract({
      address: token.address,
      abi: erc20Abi,
      functionName: "approve",
      args: [POT_ADDRESS, maxUint256],
    });
    await celoClient.waitForTransactionReceipt({ hash });
    approveTx = hash;
  }

  // Allocation: equalize days-of-runway across all games. The allocator
  // looks at (balance + every treasury) and (every dailySeed), figures
  // out the days-of-runway each game would have if everyone shared the
  // same liquidity proportional to their daily burn, and tops the
  // under-funded ones up to that line. Games already above the line
  // can't be drained, so they keep their lead and the math re-runs on
  // the remainder. See `allocate` for the water-filling loop.
  const allocStates = await Promise.all(
    GAMES.map(async (g) => {
      const { treasury, dailySeed } = await readTreasuryState(g.id);
      return { id: g.id, treasury, dailySeed };
    }),
  );
  const allocations = allocate(usdtBalance, allocStates);

  // One failed tx shouldn't strand the other games' funding (or lose the
  // hashes of txs that already landed) — record the error and keep going.
  const txHashes: Record<number, string> = {};
  const txErrors: Record<number, string> = {};
  for (const a of allocations) {
    if (a.amount === 0n) continue;
    try {
      const hash = await walletClient.writeContract({
        address: POT_ADDRESS,
        abi: FREAKING_POT_ABI,
        functionName: "fundTreasury",
        args: [BigInt(a.gameId), a.amount],
      });
      await celoClient.waitForTransactionReceipt({ hash });
      txHashes[a.gameId] = hash;
    } catch (e) {
      txErrors[a.gameId] = (e as Error).message;
    }
  }

  return {
    ran: true,
    operatorAddress: account.address,
    operatorUSDT: usdtBalance,
    operatorCELO: celoBalance,
    approveTx,
    allocations,
    txHashes,
    txErrors,
  };
}

function allocate(
  balance: bigint,
  states: { id: number; treasury: bigint; dailySeed: bigint }[],
): Alloc[] {
  // Equalize days-of-runway. Concept:
  //
  //   sharedDays = (balance + sum(treasuries_active)) / sum(seeds_active)
  //
  // Each active game's target treasury is sharedDays * its dailySeed,
  // so they all end up with the same runway. We can never pull USDT
  // back out of a treasury, so any game already above sharedDays
  // (overfunded) is excluded and the math re-runs on the rest. Repeat
  // until no game is overfunded — classic water-filling.
  //
  // Bigints throughout: we compare via cross-multiplication to avoid
  // truncating sharedDays. Final per-game amounts are computed as
  // (totalLiq * seed) / totalSeed. To avoid losing 1-wei dust to bigint
  // truncation, the last active game absorbs whatever is left of the
  // balance.
  let active = states.slice();
  while (true) {
    if (active.length === 0) break;
    const totalSeed = active.reduce((s, g) => s + g.dailySeed, 0n);
    if (totalSeed === 0n) break;
    const totalLiq = balance + active.reduce((s, g) => s + g.treasury, 0n);
    // Overfunded check: treasury_i > sharedDays * seed_i, written
    // without truncation as treasury_i * totalSeed > totalLiq * seed_i.
    const overfunded = active.filter(
      (g) => g.treasury * totalSeed > totalLiq * g.dailySeed,
    );
    if (overfunded.length === 0) break;
    const overfundedIds = new Set(overfunded.map((g) => g.id));
    active = active.filter((g) => !overfundedIds.has(g.id));
  }

  if (active.length === 0) {
    return states.map((g) => ({ gameId: g.id, amount: 0n }));
  }

  const totalSeed = active.reduce((s, g) => s + g.dailySeed, 0n);
  const totalLiq = balance + active.reduce((s, g) => s + g.treasury, 0n);
  const lastActiveId = active[active.length - 1].id;

  const allocs: Alloc[] = [];
  let assigned = 0n;
  for (const g of states) {
    if (!active.some((a) => a.id === g.id)) {
      allocs.push({ gameId: g.id, amount: 0n });
      continue;
    }
    if (g.id === lastActiveId) {
      // Soak up rounding remainder so the operator's whole balance lands.
      allocs.push({ gameId: g.id, amount: balance - assigned });
      continue;
    }
    const target = (totalLiq * g.dailySeed) / totalSeed;
    const amt = target > g.treasury ? target - g.treasury : 0n;
    allocs.push({ gameId: g.id, amount: amt });
    assigned += amt;
  }
  return allocs;
}

// ------------------------------------------------- sponsor campaign states

type SponsorState = {
  name: string;
  tokenSymbol: string;
  tokenDecimals: number;
  balanceRaw: bigint;
  dailyPerDayRaw: bigint; // per day across all games this campaign covers
  budgetRaw: bigint;
  spentRaw: bigint;
  gamesCount: number;
};

async function readSponsorStates(
  operator: `0x${string}`,
): Promise<SponsorState[]> {
  if (!supabase) return [];
  const { data: campaignsData } = await supabase
    .from("sponsor_campaigns")
    .select(
      "id,name,token_address,token_symbol,token_decimals,games,daily_amount_per_game_units::text,total_budget_units::text",
    )
    .eq("active", true);
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
  const campaigns = (campaignsData ?? []) as Row[];
  if (campaigns.length === 0) return [];

  // Spent totals per campaign in one query.
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

  const balanceByToken = new Map<string, bigint>();
  const states: SponsorState[] = [];
  for (const c of campaigns) {
    const key = c.token_address.toLowerCase();
    let balance = balanceByToken.get(key);
    if (balance === undefined) {
      try {
        balance = (await celoClient.readContract({
          address: c.token_address as `0x${string}`,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [operator],
        })) as bigint;
        balanceByToken.set(key, balance);
      } catch {
        balance = 0n;
      }
    }
    const daily = BigInt(c.daily_amount_per_game_units);
    const gamesCount = c.games.length;
    const dailyPerDay = daily * BigInt(gamesCount);
    states.push({
      name: c.name,
      tokenSymbol: c.token_symbol,
      tokenDecimals: c.token_decimals,
      balanceRaw: balance,
      dailyPerDayRaw: dailyPerDay,
      budgetRaw: BigInt(c.total_budget_units),
      spentRaw: spentByCampaign.get(c.id) ?? 0n,
      gamesCount,
    });
  }
  return states;
}

// --------------------------------------------------------- message format

function formatMessage(args: {
  states: GameState[];
  sponsorStates: SponsorState[];
  fund: AutoFundReport;
  gasWarn: boolean;
  baseUrl: string;
}): string {
  const { states, sponsorStates, fund, gasWarn, baseUrl } = args;
  const lines: string[] = [];
  lines.push("*🏦 nerdos.fun — Treasury*");
  lines.push("");

  if (fund.ran && "error" in fund && fund.error) {
    lines.push(`⚠️ Auto-fund failed: \`${fund.error}\``);
    lines.push("");
  } else if (
    fund.ran &&
    "allocations" in fund &&
    fund.allocations &&
    fund.allocations.length > 0
  ) {
    const funded = fund.allocations.filter(
      (a) => a.amount !== 0n && fund.txHashes?.[a.gameId],
    );
    const failed = fund.allocations.filter(
      (a) => a.amount !== 0n && fund.txErrors?.[a.gameId],
    );
    if (funded.length > 0) {
      const total =
        Number(funded.reduce((s, a) => s + a.amount, 0n)) / TOKEN_DECIMALS;
      lines.push(`💰 *Auto-funded $${total.toFixed(2)}*`);
      for (const a of funded) {
        const label = GAMES.find((g) => g.id === a.gameId)?.label ?? a.gameId;
        const usd = Number(a.amount) / TOKEN_DECIMALS;
        lines.push(`  → ${label}: $${usd.toFixed(2)}`);
      }
    }
    for (const a of failed) {
      const label = GAMES.find((g) => g.id === a.gameId)?.label ?? a.gameId;
      lines.push(
        `⚠️ ${label} fund failed: \`${fund.txErrors?.[a.gameId]}\``,
      );
    }
    if (funded.length > 0 || failed.length > 0) lines.push("");
  }

  for (const s of states) {
    const icon = s.days === 0 ? "🔴" : s.days < 7 ? "🟡" : "🟢";
    const link = `${baseUrl}/refill?game=${s.key}`;
    const row = `${icon} *${s.label}* — $${s.treasuryUSD.toFixed(2)} · ${s.days.toFixed(1)}d runway`;
    lines.push(s.days < 7 ? `${row} — [fund](${link})` : row);
  }

  if (sponsorStates.length > 0) {
    lines.push("");
    lines.push("*🎁 Sponsor campaigns*");
    for (const s of sponsorStates) {
      const balance = Number(s.balanceRaw) / 10 ** s.tokenDecimals;
      const dailyPerDay = Number(s.dailyPerDayRaw) / 10 ** s.tokenDecimals;
      const budget = Number(s.budgetRaw) / 10 ** s.tokenDecimals;
      const spent = Number(s.spentRaw) / 10 ** s.tokenDecimals;
      const remainingBudget = budget - spent;
      const walletDays =
        dailyPerDay > 0 ? Math.floor(balance / dailyPerDay) : 0;
      const budgetDays =
        dailyPerDay > 0 ? Math.floor(remainingBudget / dailyPerDay) : 0;
      // The binding constraint is whichever (wallet, budget) runs out first.
      const effectiveDays = Math.min(walletDays, budgetDays);
      const icon =
        effectiveDays === 0 ? "🔴" : effectiveDays < 3 ? "🟡" : "🟢";
      lines.push(
        `${icon} *${s.name}* (${s.tokenSymbol}) — ${balance.toLocaleString()} bal · ${dailyPerDay.toLocaleString()}/day · ${effectiveDays}d left`,
      );
    }
  }

  if (gasWarn && fund.ran && "operatorCELO" in fund) {
    const celoBal = Number(fund.operatorCELO) / 1e18;
    lines.push("");
    lines.push(
      `⛽ *Operator low on gas* — ${celoBal.toFixed(3)} CELO. Send CELO to keep rollDay + auto-fund working.`,
    );
  }

  lines.push("");
  if ("operatorAddress" in fund && fund.operatorAddress) {
    lines.push(`Send USDT to auto-fund:`);
    lines.push(`\`${fund.operatorAddress}\``);
  } else {
    lines.push(`Operator key not configured — auto-fund disabled.`);
  }
  lines.push(`Manual refill: ${baseUrl}/refill`);
  return lines.join("\n");
}
