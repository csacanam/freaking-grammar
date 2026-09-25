"use client";

import type { DrawProof } from "@/lib/draw-proof";
import { useLang } from "@/lib/lang-provider";
import { PlayerName } from "@/components/PlayerName";

// Collapsible "How was the winner picked?" block on a History card. Walks
// the player through the exact computation roll-day ran: boundary block →
// seed → seed mod tickets → which run held the winning ticket. Everything
// shown is public and re-checkable (Celoscan + /api/draw), which is the
// point: a wallet winning several days in a row should read as "they held
// most of the tickets", not "rigged".
export function DrawProofDetails({
  day,
  winner,
  draw,
}: {
  day: string;
  winner: string | null;
  draw: DrawProof;
}) {
  const { t, uiLang } = useLang();
  const win = winner?.toLowerCase() ?? null;

  const when = draw.blockTimeIso ? new Date(draw.blockTimeIso) : null;
  const local = when?.toLocaleString(uiLang, {
    dateStyle: "medium",
    timeStyle: "medium",
  });
  const utc = when?.toISOString().replace("T", " ").slice(0, 19);

  return (
    <details className="group mt-3 pt-3 border-t border-black/5">
      <summary className="cursor-pointer list-none flex items-center justify-between text-xs font-display tracking-widest uppercase text-teal select-none">
        <span>{t.drawHowPicked}</span>
        <span className="transition-transform group-open:rotate-180">▾</span>
      </summary>

      <ol className="mt-3 flex flex-col gap-3 text-xs text-ink">
        <Step n={1} text={t.drawStep1}>
          <Field label={t.drawBlock}>
            <span className="font-mono">#{draw.block ?? "—"}</span>
          </Field>
          {when && (
            <Field label={t.drawTime}>
              {local}
              <span className="text-muted"> · {utc} UTC</span>
            </Field>
          )}
          {draw.blockHash && (
            <Field label={t.drawBlockHash}>
              <Mono>{draw.blockHash}</Mono>
            </Field>
          )}
        </Step>

        <Step n={2} text={t.drawStep2.replace("{g}", String(draw.gameId))}>
          <Field label={t.drawSeed}>
            <Mono>{draw.seed}</Mono>
          </Field>
        </Step>

        <Step n={3} text={t.drawStep3.replace("{n}", String(draw.totalTickets))}>
          <div className="font-display text-lg text-teal">
            {t.drawWinningTicket}: #{draw.winningTicket}
            <span className="text-muted text-sm"> / {draw.totalTickets}</span>
          </div>
        </Step>

        <Step n={4} text={t.drawStep4}>
          <ul className="flex flex-col gap-1 max-h-60 overflow-y-auto">
            {draw.entries.map((e, i) => {
              const hit =
                draw.winningTicket >= e.from && draw.winningTicket <= e.to;
              return (
                <li
                  key={i}
                  className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1 ${
                    hit ? "bg-teal/15 font-semibold" : ""
                  }`}
                >
                  <span className="font-mono tabular-nums text-muted shrink-0 w-16">
                    #{e.from}
                    {e.to > e.from ? `–${e.to}` : ""}
                  </span>
                  <span
                    className={`truncate flex-1 ${e.player === win ? "text-ink" : ""}`}
                  >
                    <PlayerName address={e.player} />
                  </span>
                  <span className="text-muted tabular-nums shrink-0">
                    {e.score} pts · {e.tickets} 🎟
                  </span>
                  {hit && <span className="shrink-0">🏆</span>}
                </li>
              );
            })}
          </ul>
        </Step>
      </ol>

      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs">
        <span className="text-muted">{t.drawVerify}:</span>
        {draw.block != null && (
          <Link href={`https://celoscan.io/block/${draw.block}`}>
            {t.drawOnCeloscan}
          </Link>
        )}
        {draw.payoutTx && (
          <Link href={`https://celoscan.io/tx/${draw.payoutTx}`}>
            {t.drawOnchainRecord}
          </Link>
        )}
        <Link href={`/api/draw?day=${day}`}>{t.drawRawData}</Link>
      </div>
    </details>
  );
}

function Step({
  n,
  text,
  children,
}: {
  n: number;
  text: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-2">
      <span className="shrink-0 w-5 h-5 rounded-full bg-black/5 flex items-center justify-center font-display text-[11px]">
        {n}
      </span>
      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        <p className="text-muted leading-snug">{text}</p>
        {children}
      </div>
    </li>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="text-[10px] font-display tracking-widest uppercase text-muted">
        {label}
      </span>
      <div>{children}</div>
    </div>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-[11px] break-all">{children}</span>;
}

function Link({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-teal underline underline-offset-2"
    >
      {children}
    </a>
  );
}
