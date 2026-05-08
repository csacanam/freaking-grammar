"use client";

import { useState } from "react";

// Daily plays bar chart with on-demand exact values. The previous
// version was a static SVG — readable as a trend but you couldn't
// tell if a small bar was 3 or 13. This adds:
//   - native SVG <title> for desktop hover (browser-native tooltip)
//   - touch/click selection for mobile (sticky highlight + label
//     above the chart) since <title> doesn't fire on tap
// X/Y axes are unchanged from the prior layout.
export function PlaysChart({
  data,
}: {
  data: Array<{ date: string; count: number }>;
}) {
  const [selected, setSelected] = useState<number | null>(null);

  const rawMax = Math.max(...data.map((d) => d.count), 1);
  const niceMax = niceCeil(rawMax);
  const barW = 100 / data.length;

  // X ticks: 5 evenly-spaced dates including first and last.
  const tickCount = 5;
  const xTickIndexes = Array.from({ length: tickCount }, (_, i) =>
    Math.round((i * (data.length - 1)) / (tickCount - 1)),
  );
  const yTicks = [0, Math.round(niceMax / 2), niceMax];

  const sel = selected !== null ? data[selected] : null;

  return (
    <div className="flex flex-col gap-2">
      {/* Selected-bar callout — shows on tap (mobile) or click. The
          hover tooltip on desktop is the SVG <title> below; this slot
          stays empty until the user clicks. Reserved height keeps the
          chart from jumping when the callout appears. */}
      <div className="h-4 text-xs font-mono text-muted">
        {sel ? (
          <span>
            <span className="text-ink">{sel.date}</span>{" "}
            ·{" "}
            <span className="text-ink font-semibold">
              {sel.count} {sel.count === 1 ? "play" : "plays"}
            </span>
          </span>
        ) : null}
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
                const h = (d.count / niceMax) * 100;
                const isSel = selected === i;
                return (
                  <rect
                    key={d.date}
                    x={i * barW + barW * 0.1}
                    y={100 - h}
                    width={barW * 0.8}
                    height={Math.max(h, 0.5)}
                    fill={
                      isSel ? "#1ea869" : d.count > 0 ? "#68c3a0" : "#eaeaea"
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
                    <title>
                      {d.date} · {d.count}{" "}
                      {d.count === 1 ? "play" : "plays"}
                    </title>
                  </rect>
                );
              })}
            </svg>
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
