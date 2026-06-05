"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

// Single-line text that shrinks ONLY when it would overflow its container.
// Short words render at the className's natural font size; long words get
// scaled down via transform: scale() so they still fit on one line.
//
// Why not just lower the global font size? That would punish every short
// word ("take", "el") just to handle the rare long one. The whole point
// of a per-word measurement is to keep typography big for the common case
// and only collapse on the outliers.
//
// Implementation:
//   - container <div> sets width constraints + clips overflow
//   - inner <span> is inline-block with white-space: nowrap → its
//     scrollWidth is the natural text width even when it exceeds the
//     container's clientWidth
//   - overflow ratio = scrollWidth / clientWidth; if > 1, scale by its
//     reciprocal so the text just fits
//   - transformOrigin anchors the scale so the text stays aligned to
//     whichever edge the caller asked for
//
// useLayoutEffect (not useEffect) so the scale is set BEFORE paint —
// avoids a one-frame flash at full size before shrinking.
export function AutoFitText({
  children,
  align,
  className,
  containerClassName,
}: {
  children: ReactNode;
  align: "left" | "right" | "center";
  className?: string; // typography: font, color, size, decoration
  containerClassName?: string; // layout: width, margin, etc.
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const text = textRef.current;
    if (!container || !text) return;
    // Measure at natural size — reset any prior scale first so
    // scrollWidth reports the untransformed text width.
    text.style.transform = "scale(1)";
    const overflow = text.scrollWidth / container.clientWidth;
    setScale(overflow > 1 ? 1 / overflow : 1);
  }, [children]);

  const origin =
    align === "right"
      ? "right center"
      : align === "left"
        ? "left center"
        : "center center";
  const textAlign =
    align === "right" ? "text-right" : align === "left" ? "text-left" : "text-center";

  return (
    <div
      ref={containerRef}
      className={`overflow-hidden ${textAlign} ${containerClassName ?? ""}`}
    >
      <span
        ref={textRef}
        className={className}
        style={{
          display: "inline-block",
          whiteSpace: "nowrap",
          transform: `scale(${scale})`,
          transformOrigin: origin,
        }}
      >
        {children}
      </span>
    </div>
  );
}
