// Renderers for the two daily player emails. Each returns the four
// pieces a Resend send needs (subject, preheader, bodyHtml, text). The
// outer HTML shell and List-Unsubscribe plumbing live in src/lib/email.ts —
// this file is pure string building so it's easy to unit-test / preview.
//
// Layout notes:
//  - Subjects reference "Freaking Grammar" so the brand lands even in
//    crowded inboxes where the From line gets truncated.
//  - Preheaders show TOTALS across both games — one scan-friendly line.
//    Body shows per-game breakdown.
//  - Prize units shown natively (e.g. `2.40 USDT + 4,000 COPm`) rather
//    than converted to a single USD figure, so players know exactly
//    what tokens land in their wallet if they win.
//  - Last-call body uses divider-separated blocks per game instead of
//    a single paragraph with <br>, so prize lines that wrap on mobile
//    stay readable instead of forming a wall of text.
//  - No "pot" / "UTC" / shame-based copy. Cold open, no greeting.

import type { Lang } from "./i18n";

export type PerGameState = {
  usdt: number; // human-readable USDT amount currently in the pot
  topScore: number | null; // null = nobody has played yet today
};

export type SponsorBonus = {
  games: Array<"en" | "es">; // which games this sponsor covers
  tokenSymbol: string; // e.g. "COPm"
  amountPerGame: number; // per-winner payout in that token
};

export type EmailData = {
  pots: { en: PerGameState; es: PerGameState };
  sponsors: SponsorBonus[];
};

export type RenderedEmail = {
  subject: string;
  preheader: string;
  bodyHtml: string;
  text: string;
};

// Raw prize label like "2.40 USDT + 4,000 COPm" for a single game.
function prizeLineForGame(
  data: EmailData,
  game: "en" | "es",
): string {
  const parts: string[] = [];
  parts.push(`${data.pots[game].usdt.toFixed(2)} USDT`);
  for (const s of data.sponsors) {
    if (!s.games.includes(game)) continue;
    parts.push(`${s.amountPerGame.toLocaleString("en-US")} ${s.tokenSymbol}`);
  }
  return parts.join(" + ");
}

// Sum across both games, grouped by token. Returns "4.20 USDT + 8,000 COPm".
function totalPrizeLabel(data: EmailData): string {
  const totalUSDT = data.pots.en.usdt + data.pots.es.usdt;
  const byToken = new Map<string, number>();
  for (const s of data.sponsors) {
    for (const g of s.games) {
      if (g !== "en" && g !== "es") continue;
      byToken.set(
        s.tokenSymbol,
        (byToken.get(s.tokenSymbol) ?? 0) + s.amountPerGame,
      );
    }
  }
  const parts: string[] = [`${totalUSDT.toFixed(2)} USDT`];
  for (const [sym, amount] of byToken) {
    parts.push(`${amount.toLocaleString("en-US")} ${sym}`);
  }
  return parts.join(" + ");
}

// --- OPEN EMAIL (sent at round start)
export function renderOpenEmail(
  lang: Lang,
  data: EmailData,
): RenderedEmail {
  const total = totalPrizeLabel(data);

  if (lang === "es") {
    return {
      subject: "Tienes una jugada disponible en Freaking Grammar",
      preheader: `Ronda de hoy. ${total} para ganar.`,
      bodyHtml: [
        `<p style="margin:0 0 16px;">Hoy hay nueva ronda. Tu jugada gratis te espera.</p>`,
        `<p style="margin:0 0 24px;"><strong>${total}</strong> en premios entre los dos juegos — y sigue creciendo con cada jugada.</p>`,
        `<p style="margin:0 0 24px;"><a href="__APP__" style="color:#1a8060;font-weight:600;">Juega →</a></p>`,
        `<p style="margin:0;">— Freaking Grammar</p>`,
      ].join(""),
      text: [
        `Hoy hay nueva ronda. Tu jugada gratis te espera.`,
        ``,
        `${total} en premios entre los dos juegos — y sigue creciendo con cada jugada.`,
        ``,
        `Juega: __APP__`,
        ``,
        `— Freaking Grammar`,
      ].join("\n"),
    };
  }

  return {
    subject: "You have a play available in Freaking Grammar",
    preheader: `Today's round. ${total} in prizes.`,
    bodyHtml: [
      `<p style="margin:0 0 16px;">Today's round is open. Your free play is waiting.</p>`,
      `<p style="margin:0 0 24px;"><strong>${total}</strong> up for grabs across both games — still growing with every play.</p>`,
      `<p style="margin:0 0 24px;"><a href="__APP__" style="color:#1a8060;font-weight:600;">Play →</a></p>`,
      `<p style="margin:0;">— Freaking Grammar</p>`,
    ].join(""),
    text: [
      `Today's round is open. Your free play is waiting.`,
      ``,
      `${total} up for grabs across both games — still growing with every play.`,
      ``,
      `Play: __APP__`,
      ``,
      `— Freaking Grammar`,
    ].join("\n"),
  };
}

// --- LAST CALL EMAIL (sent 2 hours before close, to non-players)

type GameBlockLabels = {
  title: string;
  topScore: string;
  wideOpen: string;
  prize: string;
};

function renderGameBlock(
  data: EmailData,
  game: "en" | "es",
  labels: GameBlockLabels,
): { html: string; text: string } {
  const prize = prizeLineForGame(data, game);
  const score = data.pots[game].topScore;
  const scoreLine =
    score === null ? labels.wideOpen : `${labels.topScore}: ${score}`;

  const html = [
    `<div style="border-top:1px solid #eeeaea;padding:14px 0;">`,
    `<div style="font-weight:600;margin-bottom:4px;">${labels.title}</div>`,
    `<div style="color:#4a4a4a;margin-bottom:2px;">${scoreLine}</div>`,
    `<div><strong>${labels.prize}: ${prize}</strong></div>`,
    `</div>`,
  ].join("");

  const text = [
    labels.title,
    `  ${scoreLine}`,
    `  ${labels.prize}: ${prize}`,
  ].join("\n");

  return { html, text };
}

export function renderLastCallEmail(
  lang: Lang,
  data: EmailData,
): RenderedEmail {
  const total = totalPrizeLabel(data);

  if (lang === "es") {
    const enBlock = renderGameBlock(data, "en", {
      title: "Inglés",
      topScore: "Puntaje a batir",
      wideOpen: "Tablero libre",
      prize: "Premio",
    });
    const esBlock = renderGameBlock(data, "es", {
      title: "Español",
      topScore: "Puntaje a batir",
      wideOpen: "Tablero libre",
      prize: "Premio",
    });

    return {
      subject: "Quedan 2 horas para ganar en Freaking Grammar",
      preheader: `${total} en premios hoy.`,
      bodyHtml: [
        `<p style="margin:0 0 8px;">La ronda cierra en 2 horas.</p>`,
        enBlock.html,
        esBlock.html,
        `<p style="margin:20px 0 24px;"><a href="__APP__" style="color:#1a8060;font-weight:600;">Tu turno →</a></p>`,
        `<p style="margin:0;">— Freaking Grammar</p>`,
      ].join(""),
      text: [
        `La ronda cierra en 2 horas.`,
        ``,
        enBlock.text,
        ``,
        esBlock.text,
        ``,
        `Tu turno: __APP__`,
        ``,
        `— Freaking Grammar`,
      ].join("\n"),
    };
  }

  const enBlock = renderGameBlock(data, "en", {
    title: "English",
    topScore: "Top score",
    wideOpen: "Board wide open",
    prize: "Prize",
  });
  const esBlock = renderGameBlock(data, "es", {
    title: "Spanish",
    topScore: "Top score",
    wideOpen: "Board wide open",
    prize: "Prize",
  });

  return {
    subject: "2 hours left to win in Freaking Grammar",
    preheader: `${total} in prizes today.`,
    bodyHtml: [
      `<p style="margin:0 0 8px;">Round closes in 2 hours.</p>`,
      enBlock.html,
      esBlock.html,
      `<p style="margin:20px 0 24px;"><a href="__APP__" style="color:#1a8060;font-weight:600;">Take your shot →</a></p>`,
      `<p style="margin:0;">— Freaking Grammar</p>`,
    ].join(""),
    text: [
      `Round closes in 2 hours.`,
      ``,
      enBlock.text,
      ``,
      esBlock.text,
      ``,
      `Take your shot: __APP__`,
      ``,
      `— Freaking Grammar`,
    ].join("\n"),
  };
}
