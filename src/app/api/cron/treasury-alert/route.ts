import type { NextRequest } from "next/server";
import {
  createWalletClient,
  erc20Abi,
  http,
  isAddressEqual,
  maxUint256,
  parseEther,
  zeroAddress,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { CELO_RPC_URL, POT_ADDRESS, STABLECOIN, ACTIVE_CHAIN } from "@/lib/wagmi";
import {
  FREAKING_POT_ABI,
  celoClient,
  readTreasuryState,
} from "@/lib/onchain";
import { TOKEN_DECIMALS } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const GAMES = [
  { id: 1, key: "en", label: "EN" },
  { id: 2, key: "es", label: "ES" },
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

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) {
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
      fundReport = { ran: true, error: (e as Error).message };
    }
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

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin;
  const text = formatMessage({
    states,
    fund: fundReport,
    gasWarn,
    baseUrl,
  });

  const res = await fetch(
    `https://api.telegram.org/bot${botToken}/sendMessage`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      }),
    },
  );
  const tg = await res.json().catch(() => ({}));
  return Response.json({
    sent: res.ok,
    states,
    fund: serializeFund(fundReport),
    tg,
  });
}

function serializeFund(f: AutoFundReport): unknown {
  if (!f.ran) return { ran: false };
  if ("error" in f) return { ran: true, error: f.error };
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
  };
}

// --------------------------------------------------------------- auto-fund

type AutoFundReport =
  | { ran: false }
  | { ran: true; error: string }
  | {
      ran: true;
      operatorAddress: `0x${string}`;
      operatorUSDT: bigint;
      operatorCELO: bigint;
      skipped?: "no-balance";
      approveTx?: string;
      allocations?: Alloc[];
      txHashes?: Record<number, string>;
    };

async function autoFund(pkHex: Hex): Promise<AutoFundReport> {
  const account = privateKeyToAccount(
    (pkHex.startsWith("0x") ? pkHex : `0x${pkHex}`) as Hex,
  );
  const walletClient = createWalletClient({
    account,
    chain: celo,
    transport: http(CELO_RPC_URL),
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

  // Allocation: each game gets topped up toward TARGET_DAYS of runway first,
  // any leftover splits 50/50 so the whole balance always gets used.
  const states = await Promise.all(
    GAMES.map(async (g) => {
      const { treasury, dailySeed } = await readTreasuryState(g.id);
      const target = TARGET_DAYS * dailySeed;
      const gap = treasury < target ? target - treasury : 0n;
      return { id: g.id, gap };
    }),
  );
  const allocations = allocate(usdtBalance, states);

  const txHashes: Record<number, string> = {};
  for (const a of allocations) {
    if (a.amount === 0n) continue;
    const hash = await walletClient.writeContract({
      address: POT_ADDRESS,
      abi: FREAKING_POT_ABI,
      functionName: "fundTreasury",
      args: [BigInt(a.gameId), a.amount],
    });
    await celoClient.waitForTransactionReceipt({ hash });
    txHashes[a.gameId] = hash;
  }

  return {
    ran: true,
    operatorAddress: account.address,
    operatorUSDT: usdtBalance,
    operatorCELO: celoBalance,
    approveTx,
    allocations,
    txHashes,
  };
}

function allocate(
  balance: bigint,
  states: { id: number; gap: bigint }[],
): Alloc[] {
  const totalGap = states.reduce((s, g) => s + g.gap, 0n);

  if (totalGap === 0n) {
    // Both above target → split remainder 50/50
    const each = balance / BigInt(states.length);
    const last = balance - each * BigInt(states.length - 1);
    return states.map((g, i) => ({
      gameId: g.id,
      amount: i === states.length - 1 ? last : each,
    }));
  }

  if (balance <= totalGap) {
    // Not enough to cover both gaps → proportional to gap
    const allocs: Alloc[] = [];
    let assigned = 0n;
    for (let i = 0; i < states.length - 1; i++) {
      const amt = (balance * states[i].gap) / totalGap;
      allocs.push({ gameId: states[i].id, amount: amt });
      assigned += amt;
    }
    allocs.push({
      gameId: states[states.length - 1].id,
      amount: balance - assigned,
    });
    return allocs;
  }

  // Balance covers both gaps → fill gaps, split extra 50/50
  const extra = balance - totalGap;
  const each = extra / BigInt(states.length);
  const last = extra - each * BigInt(states.length - 1);
  return states.map((g, i) => ({
    gameId: g.id,
    amount:
      g.gap + (i === states.length - 1 ? last : each),
  }));
}

// --------------------------------------------------------- message format

function formatMessage(args: {
  states: GameState[];
  fund: AutoFundReport;
  gasWarn: boolean;
  baseUrl: string;
}): string {
  const { states, fund, gasWarn, baseUrl } = args;
  const lines: string[] = [];
  lines.push("*🏦 Freaking Grammar — Treasury*");
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
    const total = Number(fund.operatorUSDT ?? 0n) / TOKEN_DECIMALS;
    lines.push(`💰 *Auto-funded $${total.toFixed(2)}*`);
    for (const a of fund.allocations) {
      if (a.amount === 0n) continue;
      const label = GAMES.find((g) => g.id === a.gameId)?.label ?? a.gameId;
      const usd = Number(a.amount) / TOKEN_DECIMALS;
      lines.push(`  → ${label}: $${usd.toFixed(2)}`);
    }
    lines.push("");
  }

  for (const s of states) {
    const icon = s.days === 0 ? "🔴" : s.days < 7 ? "🟡" : "🟢";
    const link = `${baseUrl}/refill?game=${s.key}`;
    const row = `${icon} *${s.label}* — $${s.treasuryUSD.toFixed(2)} · ${s.days.toFixed(1)}d runway`;
    lines.push(s.days < 7 ? `${row} — [fund](${link})` : row);
  }

  if (gasWarn && fund.ran && "operatorCELO" in fund) {
    const celoBal = Number(fund.operatorCELO) / 1e18;
    lines.push("");
    lines.push(
      `⛽ *Operator low on gas* — ${celoBal.toFixed(3)} CELO. Send CELO to keep rollDay + auto-fund working.`,
    );
  }

  lines.push("");
  if ("operatorAddress" in fund) {
    lines.push(`Send USDT to auto-fund:`);
    lines.push(`\`${fund.operatorAddress}\``);
  } else {
    lines.push(`Operator key not configured — auto-fund disabled.`);
  }
  lines.push(`Manual refill: ${baseUrl}/refill`);
  return lines.join("\n");
}
