"use client";

import { useEffect, useState } from "react";
import { fmtCountdown } from "@/lib/format";

export function Countdown({ targetIso, className }: { targetIso: string; className?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const seconds = Math.max(0, Math.floor((new Date(targetIso).getTime() - now) / 1000));
  return <span className={className}>{fmtCountdown(seconds)}</span>;
}
