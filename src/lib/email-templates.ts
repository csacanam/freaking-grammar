// Renderers for the two daily player emails. Each returns the four
// pieces a Resend send needs (subject, preheader, bodyHtml, text). The
// outer HTML shell and List-Unsubscribe plumbing live in src/lib/email.ts —
// this file is pure string building so it's easy to unit-test / preview.
//
// Design intent (agreed with Camilo):
//  - Subjects reference "Freaking Grammar" so the brand lands even in
//    crowded inboxes where the From line gets truncated.
//  - Preheaders show TOTALS across both games — one scan-friendly line.
//    Body shows per-game breakdown.
//  - Prize units shown natively (e.g. `2.40 USDT + 4,000 COPm`) rather
//    than converted to a single USD figure, so players know exactly
//    what tokens land in their wallet if they win.
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
      preheader: `Nueva ronda. ${total} para ganar.`,
      bodyHtml: [
        `<p style="margin:0 0 16px;">Acaba de iniciar una nueva ronda. Tu jugada gratis te espera.</p>`,
        `<p style="margin:0 0 16px;">Hoy se entregan ${total} en premios entre los dos juegos — y crece a medida que otros juegan.</p>`,
        `<p style="margin:0 0 24px;"><a href="__APP__" style="color:#1a8060;font-weight:600;">Juega →</a></p>`,
        `<p style="margin:0;">— Freaking Grammar</p>`,
      ].join(""),
      text: [
        `Acaba de iniciar una nueva ronda. Tu jugada gratis te espera.`,
        ``,
        `Hoy se entregan ${total} en premios entre los dos juegos — y crece a medida que otros juegan.`,
        ``,
        `Juega: __APP__`,
        ``,
        `— Freaking Grammar`,
      ].join("\n"),
    };
  }

  return {
    subject: "You have a play available in Freaking Grammar",
    preheader: `New round. ${total} in prizes.`,
    bodyHtml: [
      `<p style="margin:0 0 16px;">New round just started. Your free play is waiting.</p>`,
      `<p style="margin:0 0 16px;">${total} up for grabs today across both games — and it grows as people play.</p>`,
      `<p style="margin:0 0 24px;"><a href="__APP__" style="color:#1a8060;font-weight:600;">Play →</a></p>`,
      `<p style="margin:0;">— Freaking Grammar</p>`,
    ].join(""),
    text: [
      `New round just started. Your free play is waiting.`,
      ``,
      `${total} up for grabs today across both games — and it grows as people play.`,
      ``,
      `Play: __APP__`,
      ``,
      `— Freaking Grammar`,
    ].join("\n"),
  };
}

// --- LAST CALL EMAIL (sent 2 hours before close, to non-players)
export function renderLastCallEmail(
  lang: Lang,
  data: EmailData,
): RenderedEmail {
  const total = totalPrizeLabel(data);
  const enPrize = prizeLineForGame(data, "en");
  const esPrize = prizeLineForGame(data, "es");

  const enScoreLine = (score: number | null, label: string, openLabel: string) =>
    score === null
      ? `${openLabel} · ${label}`
      : `${label === "Prize" ? "Top score" : "Puntaje a batir"}: ${score} · ${label}`;

  if (lang === "es") {
    const enLine =
      data.pots.en.topScore === null
        ? `Tablero libre · Premio: ${enPrize}`
        : `Puntaje a batir: ${data.pots.en.topScore} · Premio: ${enPrize}`;
    const esLine =
      data.pots.es.topScore === null
        ? `Tablero libre · Premio: ${esPrize}`
        : `Puntaje a batir: ${data.pots.es.topScore} · Premio: ${esPrize}`;

    return {
      subject: "Quedan 2 horas para ganar en Freaking Grammar",
      preheader: `${total} en premios hoy.`,
      bodyHtml: [
        `<p style="margin:0 0 16px;">La ronda cierra en 2 horas.</p>`,
        `<p style="margin:0 0 16px;">Inglés — ${enLine}<br>Español — ${esLine}</p>`,
        `<p style="margin:0 0 24px;"><a href="__APP__" style="color:#1a8060;font-weight:600;">Tu turno →</a></p>`,
        `<p style="margin:0;">— Freaking Grammar</p>`,
      ].join(""),
      text: [
        `La ronda cierra en 2 horas.`,
        ``,
        `Inglés — ${enLine}`,
        `Español — ${esLine}`,
        ``,
        `Tu turno: __APP__`,
        ``,
        `— Freaking Grammar`,
      ].join("\n"),
    };
  }

  const enLine =
    data.pots.en.topScore === null
      ? `Board wide open · Prize: ${enPrize}`
      : `Top score: ${data.pots.en.topScore} · Prize: ${enPrize}`;
  const esLine =
    data.pots.es.topScore === null
      ? `Board wide open · Prize: ${esPrize}`
      : `Top score: ${data.pots.es.topScore} · Prize: ${esPrize}`;

  void enScoreLine;

  return {
    subject: "2 hours left to win in Freaking Grammar",
    preheader: `${total} in prizes today.`,
    bodyHtml: [
      `<p style="margin:0 0 16px;">Round closes in 2 hours.</p>`,
      `<p style="margin:0 0 16px;">English — ${enLine}<br>Spanish — ${esLine}</p>`,
      `<p style="margin:0 0 24px;"><a href="__APP__" style="color:#1a8060;font-weight:600;">Take your shot →</a></p>`,
      `<p style="margin:0;">— Freaking Grammar</p>`,
    ].join(""),
    text: [
      `Round closes in 2 hours.`,
      ``,
      `English — ${enLine}`,
      `Spanish — ${esLine}`,
      ``,
      `Take your shot: __APP__`,
      ``,
      `— Freaking Grammar`,
    ].join("\n"),
  };
}
