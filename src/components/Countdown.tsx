"use client";

import { useEffect, useState } from "react";
import { fmtCountdown } from "@/lib/format";

// `now` starts as null so the SSR pass and the first client render emit
// the same placeholder ("--:--:--"). Without this, the server snapshot
// captured (say) 10:38:44 and the browser hydrated at 10:38:41 a few
// seconds later, triggering a hydration mismatch on every page that
// uses Countdown. After mount we flip `now` and tick once a second.
export function Countdown({ targetIso, className }: { targetIso: string; className?: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const label =
    now === null
      ? "--:--:--"
      : fmtCountdown(
          Math.max(0, Math.floor((new Date(targetIso).getTime() - now) / 1000)),
        );
  return <span className={className}>{label}</span>;
}
