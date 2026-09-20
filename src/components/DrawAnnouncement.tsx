"use client";

import { useSyncExternalStore } from "react";
import { useLang } from "@/lib/lang-provider";

// One-time announcement of the daily-draw dynamic (live since 2026-09-21):
// the pot is raffled among the day's paid runs instead of going to the top
// score. Dismiss persists in localStorage so regulars see it exactly once;
// remove the component once the change is old news.
const DISMISS_KEY = "draw-announce-2026-09-21";

// localStorage read via useSyncExternalStore: the server snapshot says
// "dismissed" so SSR/hydration renders nothing, then the client snapshot
// takes over — no flash for users who already dismissed, no setState-in-
// effect. The listener set makes dismissal reactive within the tab.
let listeners: Array<() => void> = [];
function subscribe(cb: () => void) {
  listeners.push(cb);
  return () => {
    listeners = listeners.filter((l) => l !== cb);
  };
}
function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

export function DrawAnnouncement() {
  const dismissed = useSyncExternalStore(
    subscribe,
    readDismissed,
    () => true, // server: render nothing until the client knows
  );
  const { t } = useLang();

  if (dismissed) return null;

  return (
    <div className="rounded-3xl bg-yellow/40 border border-yellow/60 px-4 py-3 flex flex-col gap-1.5">
      <div className="font-display text-base tracking-wider uppercase text-ink">
        🎟 {t.drawAnnounceTitle}
      </div>
      <p className="text-sm text-ink/80 leading-snug">{t.drawAnnounceBody}</p>
      <button
        onClick={() => {
          try {
            localStorage.setItem(DISMISS_KEY, "1");
          } catch {
            /* private mode — banner just reappears next visit */
          }
          for (const l of listeners) l();
        }}
        className="self-end text-xs font-display tracking-widest uppercase text-ink/70 hover:text-ink"
      >
        {t.drawAnnounceCta}
      </button>
    </div>
  );
}
