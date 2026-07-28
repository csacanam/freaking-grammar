"use client";

import { useState } from "react";

// Daily plays bar chart with on-demand exact values. The previous
// version was a static SVG — readable as a trend but you couldn't
// tell if a small bar was 3 or 13. This adds:
//   - native SVG <title> for desktop hover (browser-native tooltip)
//   - touch/click selection for mobile (sticky highlight + label
//     above the chart) since <title> doesn't fire on tap
//
// Two variants off the same 30-day series:
//   "total" — every finished run, the original chart
//   "paid"  — paid runs only, plus a break-even line. Paid and free
//             plays differ by ~2 orders of magnitude (thousands of free
//             vs tens of paid), so a stacked bar buries the paid slice
//             in a pixel; the revenue series needs its own Y scale.
export type PlaysChartPoint = {
  date: string;
  count: number;
  paid: number;
  revenueUSD: number;
};

const TOTAL = "#68c3a0";
const TOTAL_SEL = "#1ea869";
const PAID = "#1ea869";
const PAID_SEL = "#0f7a4a";
const EMPTY = "#eaeaea";
const BREAK_EVEN = "#e0492e";

export function PlaysChart({
  data,
  variant = "total",
  breakEven = null,
  labels,
}: {
  data: PlaysChartPoint[];
  variant?: "total" | "paid";
  // Paid plays/day needed to cover the daily prize seeding. Null when
  // the seed can't be read on-chain (RPC down, contract unset).
  breakEven?: number | null;
  labels: {
    plays: string;
    paid: string;
    breakEven: string;
    breakEvenHint: string;
    perDay: string;
  };
}) {
  const [selected, setSelected] = useState<number | null>(null);

  const isPaid = variant === "paid";
  const valueOf = (d: PlaysChartPoint) => (isPaid ? d.paid : d.count);
  const be = isPaid ? breakEven : null;

  const rawMax = Math.max(...data.map(valueOf), 1);
  // Fold the break-even line into the Y scale only when it's within
  // reach of the bars. Otherwise a far-away target squashes every bar
  // to a sliver; we pin the line to the top with a ↑ marker instead.
  const beAbove = be !== null && be > rawMax * 2;
  const niceMax = niceCeil(be !== null && !beAbove ? Math.max(rawMax, be) : rawMax);
  const beTopPct =
    be === null ? null : (1 - Math.min(be, niceMax) / niceMax) * 100;
  const barW = 100 / data.length;

  // X ticks: 5 evenly-spaced dates including first and last.
  const tickCount = 5;
  const xTickIndexes = Array.from({ length: tickCount }, (_, i) =>
    Math.round((i * (data.length - 1)) / (tickCount - 1)),
  );
  const yTicks = [0, Math.round(niceMax / 2), niceMax];

  const sel = selected !== null ? data[selected] : null;

  // One string per bar, reused by the click callout and the native
  // hover tooltip. React only accepts a single text node in <title>.
  const describe = (d: PlaysChartPoint) =>
    isPaid
      ? `${d.date} · ${d.paid} ${labels.paid.toLowerCase()} · $${d.revenueUSD.toFixed(2)}`
      : `${d.date} · ${d.count} ${labels.plays.toLowerCase()}`;

  return (
    <div className="flex flex-col gap-2">
      {/* Selected-bar callout — shows on tap (mobile) or click. The
          hover tooltip on desktop is the SVG <title> below; this slot
          stays empty until the user clicks. Reserved height keeps the
          chart from jumping when the callout appears. */}
      <div className="h-4 text-xs font-mono text-muted">
        {sel ? <span className="text-ink">{describe(sel)}</span> : null}
      </div>

      <div className="flex gap-2">
        {/* Y-axis labels */}
        <div
          className="flex flex-col justify-between text-[10px] text-muted font-mono tabular-nums"
          style={{ height: 96 }}
        >
          {[...yTicks].reverse().map((v) => (
            <span key={v} className="leading-none">
              {v}
            </span>
          ))}
        </div>

        {/* Plot area */}
        <div className="flex-1 min-w-0">
          <div className="relative" style={{ height: 96 }}>
            {yTicks.map((v) => (
              <div
                key={v}
                className="absolute left-0 right-0 border-t border-black/10"
                style={{ top: `${(1 - v / niceMax) * 100}%` }}
              />
            ))}
            <svg
              viewBox="0 0 100 100"
              className="absolute inset-0 w-full h-full"
              preserveAspectRatio="none"
              onMouseLeave={() => setSelected(null)}
            >
              {data.map((d, i) => {
                const v = valueOf(d);
                const h = (v / niceMax) * 100;
                const isSel = selected === i;
                return (
                  <rect
                    key={d.date}
                    x={i * barW + barW * 0.1}
                    y={100 - h}
                    width={barW * 0.8}
                    height={Math.max(h, 0.5)}
                    fill={
                      v === 0
                        ? EMPTY
                        : isSel
                          ? isPaid
                            ? PAID_SEL
                            : TOTAL_SEL
                          : isPaid
                            ? PAID
                            : TOTAL
                    }
                    onMouseEnter={() => setSelected(i)}
                    onClick={() =>
                      setSelected((prev) => (prev === i ? null : i))
                    }
                    style={{ cursor: "pointer" }}
                  >
                    {/* Native browser tooltip — works on desktop hover
                        without needing the React state. Mobile gets the
                        callout above via the click handler. */}
                    <title>{describe(d)}</title>
                  </rect>
                );
              })}
            </svg>
            {/* Break-even line, drawn as a DOM element rather than an SVG
                <line>: the chart's viewBox is non-uniform
                (preserveAspectRatio="none"), which would stretch the dash
                pattern and stroke width horizontally. */}
            {beTopPct !== null ? (
              <div
                className="absolute left-0 right-0 border-t border-dashed pointer-events-none"
                style={{ top: `${beTopPct}%`, borderColor: BREAK_EVEN }}
              />
            ) : null}
          </div>
          {/* X-axis labels */}
          <div className="relative h-4 mt-1">
            {xTickIndexes.map((idx) => {
              const d = data[idx];
              if (!d) return null;
              const left = (idx + 0.5) * barW;
              return (
                <span
                  key={d.date}
                  className="absolute text-[10px] text-muted font-mono -translate-x-1/2"
                  style={{ left: `${left}%` }}
                >
                  {d.date.slice(5)}
                </span>
              );
            })}
          </div>
        </div>
      </div>

      {/* Legend for the break-even line — the whole point of the paid
          chart: bars above the line paid for that day's prize seeding. */}
      {beTopPct !== null ? (
        <div className="flex items-center gap-1.5 text-[10px] text-muted font-mono">
          <span
            className="inline-block w-3 border-t border-dashed shrink-0"
            style={{ borderColor: BREAK_EVEN }}
          />
          <span>
            {labels.breakEven}: {be}
            {labels.perDay}
            {beAbove ? " ↑" : ""} — {labels.breakEvenHint}
          </span>
        </div>
      ) : null}
    </div>
  );
}

// Round a count up to the next "nice" number so the Y-axis tops out
// somewhere readable. 17 → 20, 34 → 50, 89 → 100, 137 → 200, etc.
function niceCeil(n: number): number {
  if (n <= 5) return 5;
  if (n <= 10) return 10;
  const exp = Math.pow(10, Math.floor(Math.log10(n)));
  const norm = n / exp;
  let nice;
  if (norm <= 1) nice = 1;
  else if (norm <= 2) nice = 2;
  else if (norm <= 5) nice = 5;
  else nice = 10;
  return nice * exp;
}
