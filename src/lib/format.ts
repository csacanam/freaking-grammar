export function fmtUSD(n: number): string {
  return `$${n.toFixed(2)}`;
}

export function shortAddr(addr?: string | null): string {
  if (!addr) return "—";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function fmtCountdown(secondsLeft: number): string {
  const s = Math.max(0, Math.floor(secondsLeft));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export function secondsUntilUtcMidnight(now = new Date()): number {
  const next = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0, 0, 0, 0
  ));
  return Math.floor((next.getTime() - now.getTime()) / 1000);
}

export function utcDayString(d = new Date()): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD UTC
}

// Pretty error messages for wagmi/viem exceptions. Collapses the noisy viem
// stack into a single human sentence and caps length.
export function friendlyError(e: unknown, cap = 160): string {
  const msg = (e as Error)?.message ?? "Something went wrong.";
  if (/user rejected|rejected the request|denied/i.test(msg)) {
    return "Transaction rejected.";
  }
  if (/insufficient funds/i.test(msg)) return "Insufficient funds for gas.";
  if (/insufficient allowance/i.test(msg)) return "Insufficient USDT allowance.";
  const head = msg.split(/\n|\. /)[0].trim();
  return head.length > cap ? head.slice(0, cap) + "…" : head;
}
