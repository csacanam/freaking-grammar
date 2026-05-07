"use client";

import { useEffect, useState } from "react";
import { usePublicClient } from "wagmi";
import { parseAbiItem, isAddressEqual, zeroAddress } from "viem";
import { fmtUSD, shortAddr } from "@/lib/format";
import { ACTIVE_CHAIN, POT_ADDRESS } from "@/lib/chain";
import { useLang } from "@/lib/lang-provider";

const TOKEN_DECIMALS = 1_000_000;

const PROTOCOL_LABEL = "nerdos.fun Protocol";

type Entry = {
  key: string;
  name: string;
  totalUSD: number;
  boosts: number;
  isProtocol?: boolean;
};

const SPONSORED_EVENT = parseAbiItem(
  "event PotSponsored(uint256 indexed gameId, uint256 indexed day, address indexed sponsor, uint256 amount)",
);
const SEEDED_EVENT = parseAbiItem(
  "event DaySeeded(uint256 indexed gameId, uint256 indexed day, uint256 amount)",
);
const ROLLED_EVENT = parseAbiItem(
  "event DayRolled(uint256 indexed gameId, uint256 indexed closedDay, address closedWinner, uint256 closedPot, uint256 indexed newDay, uint256 seeded)",
);

export function SponsorLeaderboard() {
  const publicClient = usePublicClient({ chainId: ACTIVE_CHAIN.id });
  const { t } = useLang();
  const [entries, setEntries] = useState<Entry[] | null>(null);

  useEffect(() => {
    if (!publicClient) return;
    if (isAddressEqual(POT_ADDRESS, zeroAddress)) {
      setEntries([]);
      return;
    }

    let alive = true;

    (async () => {
      try {
        const [sponsored, seeded, rolled] = await Promise.all([
          publicClient.getLogs({
            address: POT_ADDRESS,
            event: SPONSORED_EVENT,
            fromBlock: 0n,
            toBlock: "latest",
          }),
          publicClient.getLogs({
            address: POT_ADDRESS,
            event: SEEDED_EVENT,
            fromBlock: 0n,
            toBlock: "latest",
          }),
          publicClient.getLogs({
            address: POT_ADDRESS,
            event: ROLLED_EVENT,
            fromBlock: 0n,
            toBlock: "latest",
          }),
        ]);

        const byAddr = new Map<string, { total: bigint; boosts: number }>();
        for (const log of sponsored) {
          const sponsor = (log.args.sponsor as string).toLowerCase();
          const amt = (log.args.amount as bigint) ?? 0n;
          const prev = byAddr.get(sponsor) ?? { total: 0n, boosts: 0 };
          byAddr.set(sponsor, {
            total: prev.total + amt,
            boosts: prev.boosts + 1,
          });
        }

        // Protocol's cumulative contribution = DaySeeded + DayRolled.seeded
        let protocolTotal = 0n;
        let protocolBoosts = 0;
        for (const log of seeded) {
          protocolTotal += (log.args.amount as bigint) ?? 0n;
          protocolBoosts++;
        }
        for (const log of rolled) {
          const s = (log.args.seeded as bigint) ?? 0n;
          if (s > 0n) {
            protocolTotal += s;
            protocolBoosts++;
          }
        }

        const list: Entry[] = [];
        if (protocolTotal > 0n || protocolBoosts > 0) {
          list.push({
            key: "protocol",
            name: PROTOCOL_LABEL,
            totalUSD: Number(protocolTotal) / TOKEN_DECIMALS,
            boosts: protocolBoosts,
            isProtocol: true,
          });
        }
        for (const [addr, v] of byAddr) {
          list.push({
            key: addr,
            name: shortAddr(addr),
            totalUSD: Number(v.total) / TOKEN_DECIMALS,
            boosts: v.boosts,
          });
        }
        list.sort((a, b) => b.totalUSD - a.totalUSD);

        if (alive) setEntries(list);
      } catch (e) {
        console.error("sponsor leaderboard read failed:", e);
        if (alive) setEntries([]);
      }
    })();

    return () => {
      alive = false;
    };
  }, [publicClient]);

  return (
    <div className="rounded-3xl bg-white border border-black/5 p-5 shadow-[0_4px_0_0_rgba(0,0,0,0.04)]">
      <h2 className="font-display text-2xl mb-3">🏆 Sponsors all-time</h2>
      {entries === null && (
        <div className="h-20 rounded-2xl bg-black/5 animate-pulse" />
      )}
      {entries && entries.length === 0 && (
        <p className="text-sm text-muted text-center py-4">
          {t.sponsorEmptyState}
        </p>
      )}
      {entries && entries.length > 0 && (
        <ul className="divide-y divide-black/5">
          {entries.map((e, i) => (
            <li key={e.key} className="flex items-center gap-3 py-3">
              <span
                className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center font-display text-lg ${
                  i === 0
                    ? "bg-yellow text-ink"
                    : i === 1
                    ? "bg-purple/20 text-purple"
                    : i === 2
                    ? "bg-orange/30 text-ink"
                    : "bg-black/[0.04] text-muted"
                }`}
              >
                {i + 1}
              </span>
              <span className="flex-1 font-mono text-sm text-ink truncate">
                {e.name}
                {e.isProtocol && (
                  <span className="ml-2 text-[10px] text-teal font-display uppercase">
                    protocol
                  </span>
                )}
              </span>
              <div className="text-right">
                <div className="font-display text-lg tabular-nums leading-none">
                  {fmtUSD(e.totalUSD)}
                </div>
                <div className="text-[10px] text-muted">
                  {e.boosts} boost{e.boosts === 1 ? "" : "s"}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
