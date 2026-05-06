"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useLang } from "@/lib/lang-provider";

export function BottomTabs() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { t, game } = useLang();
  // Hidden on the platform picker (/) — that's the nerdos.fun landing,
  // not a game context. Hidden inside an active /grammar/game session.
  if (pathname === "/") return null;
  if (pathname?.startsWith("/grammar/game")) return null;

  // Keep the active lang in URLs so navigation preserves it.
  const params = new URLSearchParams(searchParams?.toString() ?? "");
  params.set("game", game);
  const qs = `?${params.toString()}`;

  // Tabs are scoped to the Grammar app for now; when /math launches its
  // own home + history, BottomTabs will render the matching set per
  // pathname (or move to a per-app layout).
  const tabs = [
    { href: `/grammar${qs}`, path: "/grammar", key: "home", label: t.tabPlay, Icon: HomeIcon },
    { href: `/grammar/history${qs}`, path: "/grammar/history", key: "history", label: t.tabHistory, Icon: HistoryIcon },
    { href: `/you${qs}`, path: "/you", key: "you", label: t.tabYou, Icon: YouIcon },
  ];

  return (
    <nav className="fixed bottom-0 inset-x-0 h-20 bg-white border-t border-black/5 flex items-stretch justify-around z-40 pb-[env(safe-area-inset-bottom)] max-w-md mx-auto rounded-t-3xl shadow-[0_-8px_24px_rgba(0,0,0,0.06)] sm:rounded-t-3xl">
      {tabs.map(({ href, path, key, label, Icon }) => {
        const active =
          pathname === path ||
          (path !== "/grammar" && pathname?.startsWith(path)) ||
          (path === "/grammar" && pathname?.startsWith("/grammar") && !pathname?.startsWith("/grammar/history"));
        return (
          <Link
            key={key}
            href={href}
            className={`flex-1 flex flex-col items-center justify-center gap-1 ${
              active ? "text-ink" : "text-muted"
            }`}
          >
            <Icon active={!!active} />
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
