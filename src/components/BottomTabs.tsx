"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useLang } from "@/lib/lang-provider";

const LAST_GAME_KEY = "nerdos:lastGame";

export function BottomTabs() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { t, game } = useLang();

  // Remember which game the user was in last so /you (a cross-game
  // route) can route Home/History back to the same game they came
  // from — landing on /you from /math then tapping History should go
  // to /math/history, not bounce back to Grammar.
  const [lastGame, setLastGame] = useState<"grammar" | "math">("grammar");

  useEffect(() => {
    // Hydrate from localStorage on mount so a hard refresh on /you
    // doesn't lose the context. Default 'grammar' is fine for first-
    // time visitors — it's the only game they'd have entered before.
    const stored = localStorage.getItem(LAST_GAME_KEY);
    if (stored === "math" || stored === "grammar") {
      setLastGame(stored);
    }
  }, []);

  useEffect(() => {
    if (pathname?.startsWith("/math")) {
      setLastGame("math");
      localStorage.setItem(LAST_GAME_KEY, "math");
    } else if (pathname?.startsWith("/grammar")) {
      setLastGame("grammar");
      localStorage.setItem(LAST_GAME_KEY, "grammar");
    }
    // /you and other shared routes don't update lastGame.
  }, [pathname]);

  // Hidden on the platform picker (/) — that's the nerdos.fun landing,
  // not a game context. Hidden inside an active gameplay session for
  // either game (no nav distractions while the timer is ticking).
  if (pathname === "/") return null;
  if (pathname?.startsWith("/grammar/game")) return null;
  if (pathname?.startsWith("/math/game")) return null;

  // Pathname tells us where we are now. For game-specific routes, that's
  // the source of truth. For shared routes (/you), fall back to the
  // remembered lastGame so History routes back to the game the user
  // was in before they bounced to their profile.
  let inMath: boolean;
  if (pathname?.startsWith("/math")) inMath = true;
  else if (pathname?.startsWith("/grammar")) inMath = false;
  else inMath = lastGame === "math";

  // Grammar URLs preserve ?game= so the EN/ES selection survives nav.
  // Math has no language to preserve so its hrefs stay clean.
  const params = new URLSearchParams(searchParams?.toString() ?? "");
  params.set("game", game);
  const grammarQs = `?${params.toString()}`;

  const tabs = inMath
    ? [
        { href: `/math`, path: "/math", key: "home", label: t.tabPlay, Icon: HomeIcon },
        { href: `/math/history`, path: "/math/history", key: "history", label: t.tabHistory, Icon: HistoryIcon },
        { href: `/you`, path: "/you", key: "you", label: t.tabYou, Icon: YouIcon },
      ]
    : [
        { href: `/grammar${grammarQs}`, path: "/grammar", key: "home", label: t.tabPlay, Icon: HomeIcon },
        { href: `/grammar/history${grammarQs}`, path: "/grammar/history", key: "history", label: t.tabHistory, Icon: HistoryIcon },
        { href: `/you${grammarQs}`, path: "/you", key: "you", label: t.tabYou, Icon: YouIcon },
      ];

  // Active rule: exact match OR (history paths) startsWith match. The
  // home tab is active on the bare /grammar or /math, but NOT on their
  // /history sub-routes — those belong to the History tab.
  const isActive = (path: string) => {
    if (pathname === path) return true;
    if (path.endsWith("/history")) return pathname?.startsWith(path) ?? false;
    if (path === "/you") return pathname?.startsWith("/you") ?? false;
    if (path === "/grammar") {
      return (
        pathname?.startsWith("/grammar") === true &&
        !pathname?.startsWith("/grammar/history")
      );
    }
    if (path === "/math") {
      return (
        pathname?.startsWith("/math") === true &&
        !pathname?.startsWith("/math/history")
      );
    }
    return false;
  };

  return (
    <nav className="fixed bottom-0 inset-x-0 h-20 bg-white border-t border-black/5 flex items-stretch justify-around z-40 pb-[env(safe-area-inset-bottom)] max-w-md mx-auto rounded-t-3xl shadow-[0_-8px_24px_rgba(0,0,0,0.06)] sm:rounded-t-3xl">
      {tabs.map(({ href, path, key, label, Icon }) => {
        const active = isActive(path);
        return (
          <Link
            key={key}
            href={href}
            className={`flex-1 flex flex-col items-center justify-center gap-1 ${
              active ? "text-ink" : "text-muted"
            }`}
          >
            <Icon active={active} />
            <span className="font-display text-xs tracking-wider uppercase">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function HomeIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 11l9-8 9 8v9a2 2 0 01-2 2h-4v-7h-6v7H5a2 2 0 01-2-2v-9z" fill={active ? "#2c2c2c" : "none"} />
    </svg>
  );
}

function HistoryIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" fill={active ? "#2c2c2c" : "none"} stroke="currentColor" />
      <path d="M12 7v5l3 2" stroke={active ? "#ffffff" : "currentColor"} />
    </svg>
  );
}

function YouIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" fill={active ? "#2c2c2c" : "none"} />
      <path d="M4 21c1.5-4 5-6 8-6s6.5 2 8 6" fill={active ? "#2c2c2c" : "none"} />
    </svg>
  );
}
