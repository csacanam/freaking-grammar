"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { dict, gameIdFor, type Lang, type Strings } from "./i18n";

// Two independent axes:
//   - uiLang: the interface language the user reads (detected once from the
//             browser). Doesn't change when they switch game.
//   - game:   which grammar game they're playing (EN or ES). Drives the contract
//             gameId + server queries + question language. User-switchable.
type Ctx = {
  uiLang: Lang;
  game: Lang;
  setGame: (g: Lang) => void;
  t: Strings;
  gameId: 1 | 2;
};

const GAME_KEY = "fg:game";

function detectUiLang(): Lang {
  if (typeof window === "undefined") return "en";
  const nav = navigator.language?.slice(0, 2).toLowerCase();
  return nav === "es" ? "es" : "en";
}

function pickInitialGame(urlParam: string | null | undefined): Lang {
  if (urlParam === "es" || urlParam === "en") return urlParam;
  if (typeof window === "undefined") return "en";
  const stored = window.localStorage.getItem(GAME_KEY);
  if (stored === "es" || stored === "en") return stored;
  // First-time visitor: start them on the game that matches their UI lang.
  return detectUiLang();
}

const LangCtx = createContext<Ctx | null>(null);

export function LangProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const urlGame = searchParams?.get("game");

  // SSR-safe initial values (hydrate on mount).
  const [uiLang, setUiLang] = useState<Lang>("en");
  const [game, setGameState] = useState<Lang>(
    urlGame === "es" || urlGame === "en" ? urlGame : "en",
  );

  useEffect(() => {
    setUiLang(detectUiLang());
    if (!(urlGame === "es" || urlGame === "en")) {
      setGameState(pickInitialGame(null));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setGame(g: Lang) {
    setGameState(g);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(GAME_KEY, g);
    }
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("game", g);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  const value = useMemo<Ctx>(
    () => ({
      uiLang,
      game,
      setGame,
      t: dict[uiLang],
      gameId: gameIdFor(game),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [uiLang, game, pathname],
  );

  return <LangCtx.Provider value={value}>{children}</LangCtx.Provider>;
}

export function useLang(): Ctx {
  const ctx = useContext(LangCtx);
  if (!ctx) throw new Error("useLang must be used inside <LangProvider>");
  return ctx;
}
