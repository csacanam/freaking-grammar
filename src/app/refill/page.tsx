"use client";

import { Suspense, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  useAccount,
  useConnect,
  usePublicClient,
  useReadContract,
  useSwitchChain,
  useWriteContract,
  type Connector,
} from "wagmi";
import {
  erc20Abi,
  isAddressEqual,
  maxUint256,
  parseUnits,
  zeroAddress,
} from "viem";
import { Button } from "@/components/Button";
import { WalletPicker } from "@/components/WalletPicker";
import { friendlyError, fmtUSD } from "@/lib/format";
import { ACTIVE_CHAIN, POT_ADDRESS, STABLECOIN } from "@/lib/wagmi";
import FreakingPotArtifact from "@/lib/contracts/FreakingPot.json";

const FREAKING_POT_ABI = FreakingPotArtifact.abi;

const GAMES = [
  { id: 1, key: "en", label: "English" },
  { id: 2, key: "es", label: "Español" },
];

export default function RefillPage() {
  return (
    <Suspense>
      <RefillInner />
    </Suspense>
  );
}

function RefillInner() {
  const sp = useSearchParams();
  const initialGame =
    (sp.get("game") || "").toLowerCase() === "es" ? 2 : 1;
  const initialAmount = sp.get("amount") || "10";

  const [gameId, setGameId] = useState<number>(initialGame);
  const [amount, setAmount] = useState<string>(initialAmount);
  const [stage, setStage] = useState<"idle" | "connecting" | "approving" | "funding">("idle");
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pendingRef = useRef(false);

  const { address, isConnected, chainId } = useAccount();
  const { connectAsync, connectors } = useConnect();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient({ chainId: ACTIVE_CHAIN.id });

  const contractLive = !isAddressEqual(POT_ADDRESS, zeroAddress);
  const token = STABLECOIN[ACTIVE_CHAIN.id];

  const { data: treasuryRaw, refetch: refetchTreasury } = useReadContract({
    address: POT_ADDRESS,
    abi: FREAKING_POT_ABI,
    functionName: "treasury",
    args: [BigInt(gameId)],
    chainId: ACTIVE_CHAIN.id,
    query: { enabled: contractLive },
  });
  const { data: seedRaw } = useReadContract({
    address: POT_ADDRESS,
    abi: FREAKING_POT_ABI,
    functionName: "dailySeed",
    args: [BigInt(gameId)],
    chainId: ACTIVE_CHAIN.id,
    query: { enabled: contractLive },
  });

  const treasuryUSD = useMemo(
    () => (treasuryRaw ? Number(treasuryRaw as bigint) / 1e6 : 0),
    [treasuryRaw],
  );
  const seedUSD = useMemo(
    () => (seedRaw ? Number(seedRaw as bigint) / 1e6 : 0),
    [seedRaw],
  );
  const runwayDays = seedUSD > 0 ? treasuryUSD / seedUSD : 0;

  async function runFund(currentAddress: `0x${string}`) {
    if (!publicClient) throw new Error("no-rpc");

    const amtUnits = parseUnits(amount, 6);
    if (chainId !== ACTIVE_CHAIN.id) {
      await switchChainAsync({ chainId: ACTIVE_CHAIN.id });
    }

    const allowance = (await publicClient.readContract({
      address: token.address,
      abi: erc20Abi,
      functionName: "allowance",
      args: [currentAddress, POT_ADDRESS],
    })) as bigint;

    if (allowance < amtUnits) {
      setStage("approving");
      const aHash = await writeContractAsync({
        chainId: ACTIVE_CHAIN.id,
        address: token.address,
        abi: erc20Abi,
        functionName: "approve",
        args: [POT_ADDRESS, maxUint256],
      });
      await publicClient.waitForTransactionReceipt({ hash: aHash });
    }

    setStage("funding");
    const fHash = await writeContractAsync({
      chainId: ACTIVE_CHAIN.id,
      address: POT_ADDRESS,
      abi: FREAKING_POT_ABI,
      functionName: "fundTreasury",
      args: [BigInt(gameId), amtUnits],
    });
    await publicClient.waitForTransactionReceipt({ hash: fHash });

    setTxHash(fHash);
    refetchTreasury();
  }

  async function handleFund() {
    setError(null);
    setTxHash(null);

    if (!contractLive) {
      setError("Contract not deployed yet.");
      return;
    }

    const amt = parseFloat(amount);
    if (!amt || amt <= 0) {
      setError("Enter a valid amount.");
      return;
    }

    if (!isConnected || !address) {
      pendingRef.current = true;
      setPickerOpen(true);
      return;
    }

    try {
      await runFund(address);
    } catch (e) {
      console.error("refill failed:", e);
      setError(friendlyError(e));
    } finally {
      setStage("idle");
    }
  }

  async function onPickWallet(c: Connector) {
    setPickerOpen(false);
    const wasPending = pendingRef.current;
    pendingRef.current = false;
    try {
      setStage("connecting");
      const r = await connectAsync({ connector: c });
      const addr = r.accounts[0];
      if (!addr) throw new Error("no-wallet");
      if (wasPending) await runFund(addr);
      else setStage("idle");
    } catch (e) {
      console.error("refill connect failed:", e);
      setError(friendlyError(e));
      setStage("idle");
    }
  }

  const runwayColor =
    runwayDays < 1
      ? "text-red"
      : runwayDays < 7
      ? "text-orange"
      : "text-teal";
  const busy = stage !== "idle";

  return (
    <div className="flex-1 flex flex-col px-5 pt-6 pb-10 max-w-md mx-auto w-full gap-5">
      <header>
        <h1 className="font-display text-4xl tracking-wider">Refill treasury</h1>
        <p className="text-xs font-mono text-muted mt-1">
          Any wallet can top up a game&apos;s daily-seed runway.
        </p>
      </header>

      {!contractLive && (
        <div className="rounded-2xl bg-white border border-dashed border-black/10 p-6 text-center text-muted text-sm">
          Contract not deployed yet. Set{" "}
          <code className="font-mono">NEXT_PUBLIC_FREAKING_POT_CELO</code> and
          try again.
        </div>
      )}

      <div className="rounded-3xl bg-white border border-black/5 p-5 shadow-[0_4px_0_0_rgba(0,0,0,0.04)] flex flex-col gap-4">
        <div>
          <div className="text-xs font-display tracking-widest uppercase text-muted">
            Game
          </div>
          <div className="mt-2 flex gap-2">
            {GAMES.map((g) => (
              <button
                key={g.id}
                onClick={() => setGameId(g.id)}
                className={`flex-1 rounded-xl font-display py-2 text-sm tracking-wider uppercase transition ${
                  gameId === g.id
                    ? "bg-ink text-white"
                    : "bg-black/5 text-muted"
                }`}
              >
                {g.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-teal/10 px-3 py-2">
            <div className="text-[10px] font-display tracking-widest uppercase text-muted">
              Treasury
            </div>
            <div className="font-display text-xl">{fmtUSD(treasuryUSD)}</div>
          </div>
          <div className="rounded-xl bg-yellow/30 px-3 py-2">
            <div className="text-[10px] font-display tracking-widest uppercase text-muted">
              Runway
            </div>
            <div className={`font-display text-xl ${runwayColor}`}>
              {runwayDays.toFixed(1)} days
            </div>
          </div>
        </div>
        <div className="text-[10px] text-muted font-mono">
          Daily seed: {fmtUSD(seedUSD)} · your wallet:{" "}
          {address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "—"}
        </div>

        <div>
          <div className="text-xs font-display tracking-widest uppercase text-muted">
            Amount (USDT)
          </div>
          <input
            type="number"
            min="0"
            step="1"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2 font-display text-2xl tabular-nums focus:outline-none focus:border-teal"
          />
          <div className="mt-1 flex gap-2">
            {[10, 50, 100, 500].map((n) => (
              <button
                key={n}
                onClick={() => setAmount(String(n))}
                className="text-[10px] font-display tracking-widest uppercase text-muted px-2 py-1 rounded-md bg-black/5 hover:bg-black/10"
              >
                ${n}
              </button>
            ))}
          </div>
        </div>

        <Button full disabled={busy || !contractLive} onClick={handleFund}>
          {stage === "connecting"
            ? "Connecting wallet…"
            : stage === "approving"
            ? "Approving USDT…"
            : stage === "funding"
            ? "Funding…"
            : `Fund ${fmtUSD(parseFloat(amount) || 0)}`}
        </Button>

        {error && (
          <p className="text-xs text-red text-center font-mono">{error}</p>
        )}
        {txHash && (
          <p className="text-xs text-teal text-center font-mono">
            Funded! tx:{" "}
            <a
              href={`https://celoscan.io/tx/${txHash}`}
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              {txHash.slice(0, 10)}…
            </a>
          </p>
        )}
      </div>
      <WalletPicker
        open={pickerOpen}
        connectors={connectors}
        onSelect={onPickWallet}
        onClose={() => {
          pendingRef.current = false;
          setPickerOpen(false);
        }}
      />
    </div>
  );
}
