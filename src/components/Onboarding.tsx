"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Image from "next/image";
import { useLang } from "@/lib/lang-provider";

// First-run intro on the picker home. Added for the MiniPay listing review:
// reviewers land on a bare game picker with no idea what the app is, what a
// run costs, or what they win. Four slides answer exactly that, then get out
// of the way.
//
// Shown once per browser (localStorage), and replayable from the "How it
// works" button on the picker — so it's discoverable after dismissal instead
// of being a one-shot the user can never see again.
const SEEN_KEY = "fg:onboarded";

// localStorage read as an external store. useSyncExternalStore is what makes
// this SSR-safe without a hydration mismatch: React uses getServerSnapshot on
// the server AND for the hydrating render, then swaps to getSnapshot — so the
// two renders never disagree. Reading localStorage in a plain useState
// initializer would; setting it from an effect would cascade a second render
// (and trips react-hooks/set-state-in-effect).
const subscribe = () => () => {};

// "Seen" is the safe default: on the server, and if localStorage is
// unreachable (private-mode Safari, locked-down in-app WebViews), we render
// nothing rather than flashing the intro at someone who already dismissed it
// — or, worse, on every single visit because we can't persist the flag.
const getSeenSnapshot = () => {
  try {
    return window.localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return true;
  }
};
const getSeenServerSnapshot = () => true;

/** Owns the "has this browser seen the intro" flag. */
export function useOnboarding() {
  const seen = useSyncExternalStore(
    subscribe,
    getSeenSnapshot,
    getSeenServerSnapshot,
  );
  // null = follow the stored flag; true/false = user acted this session
  // (replayed or dismissed), which wins over it.
  const [override, setOverride] = useState<boolean | null>(null);

  const close = useCallback(() => {
    setOverride(false);
    try {
      window.localStorage.setItem(SEEN_KEY, "1");
    } catch {
      // Non-fatal: worst case the intro reappears on the next visit.
    }
  }, []);

  const replay = useCallback(() => setOverride(true), []);

  return { open: override ?? !seen, close, replay };
}

export function Onboarding({ onClose }: { onClose: () => void }) {
  const { t } = useLang();
  const trackRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);

  const slides = [
    { art: "mascot" as const, title: t.obTitle1, body: t.obBody1 },
    { art: "⚡", title: t.obTitle2, body: t.obBody2 },
    { art: "🏆", title: t.obTitle3, body: t.obBody3 },
    { art: "🚀", title: t.obTitle4, body: t.obBody4 },
  ];
  const last = index === slides.length - 1;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // The track is a scroll-snap carousel, so swiping is the browser's job, not
  // ours — we only mirror where it landed into `index` to drive the dots and
  // the Next/Let's-go button. Rounding by track width survives the fractional
  // scrollLeft that momentum scrolling leaves behind.
  function syncIndex() {
    const el = trackRef.current;
    if (!el) return;
    setIndex(Math.round(el.scrollLeft / el.clientWidth));
  }

  function next() {
    const el = trackRef.current;
    if (!el) return;
    el.scrollTo({ left: (index + 1) * el.clientWidth, behavior: "smooth" });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t.obHowItWorks}
      className="fixed inset-0 z-50 bg-bg flex flex-col"
    >
      <div className="flex justify-end px-5 pt-5">
        <button
          onClick={onClose}
          className="text-[11px] font-display tracking-widest uppercase text-muted hover:text-ink px-2 py-1"
        >
          {t.obSkip}
        </button>
      </div>

      <div
        ref={trackRef}
        onScroll={syncIndex}
        className="flex-1 flex overflow-x-auto snap-x snap-mandatory [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {slides.map((s) => (
          <section
            key={s.title}
            className="snap-center shrink-0 w-full h-full flex flex-col items-center justify-center text-center px-8 gap-5"
          >
            <div className="h-24 flex items-center justify-center">
              {s.art === "mascot" ? (
                <Image src="/mascot.png" alt="" width={96} height={96} priority />
              ) : (
                <span className="text-[64px] leading-none" aria-hidden>
                  {s.art}
                </span>
              )}
            </div>
            <h2 className="font-display text-3xl tracking-wide leading-tight max-w-xs">
              {s.title}
            </h2>
            <p className="text-base text-muted leading-snug max-w-xs">
              {s.body}
            </p>
          </section>
        ))}
      </div>

      <div className="px-8 pb-10 pt-4 flex flex-col items-center gap-6">
        <div className="flex gap-2" aria-hidden>
          {slides.map((s, i) => (
            <span
              key={s.title}
              className={`h-2 rounded-full transition-all ${
                i === index ? "w-6 bg-ink" : "w-2 bg-black/15"
              }`}
            />
          ))}
        </div>
        <button
          onClick={last ? onClose : next}
          className="w-full max-w-xs px-4 py-3.5 rounded-xl bg-teal text-white font-display text-base tracking-wider uppercase shadow-[0_4px_0_0_rgba(0,0,0,0.12)] active:translate-y-[2px] active:shadow-[0_2px_0_0_rgba(0,0,0,0.12)]"
        >
          {last ? t.obStart : t.obNext}
        </button>
      </div>
    </div>
  );
}
