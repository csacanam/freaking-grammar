"use client";

import { useEffect, useState } from "react";
import { useLang } from "@/lib/lang-provider";
import { useIsMiniPay } from "@/lib/minipay";

// Support contact path. Required in-app by MiniPay listing rules (§6
// Integration & Support); Telegram is the channel, and the group is private
// so the invite link is the only way in.
//
// Why a modal instead of the bare `target="_blank"` anchor this replaces:
// a MiniPay listing reviewer reported the support link landing on an error
// page. The link itself resolves fine (t.me returns a real HTML page), so
// the suspect is the new-window request — an Android WebView without
// setSupportMultipleWindows can't open one, and some builds render an error
// page instead of doing nothing.
//
// So this component never asks for a new window inside MiniPay (see the
// anchor below), and the modal itself doubles as the fallback: even if the
// hand-off to Telegram fails, the user is still on a working in-app screen
// with a copyable link rather than staring at a WebView error.
const TELEGRAM_URL = "https://t.me/+54nPB4Whv0NlOWVh";

export function SupportModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useLang();
  const inMiniPay = useIsMiniPay();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(TELEGRAM_URL);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard is permission-gated in some WebViews. The link is visible
      // in the modal either way, so a failed copy still leaves the user able
      // to reach the group by hand.
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t.supportTitle}
        className="bg-white rounded-3xl max-w-sm w-full shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 pt-6 pb-5">
          <h2 className="font-display text-2xl tracking-wide leading-tight">
            {t.supportTitle}
          </h2>
          <p className="text-base text-muted mt-2 leading-snug">
            {t.supportBody}
          </p>

          {/* The whole point of this component: inside MiniPay we navigate the
              current frame (no target, no window.open) because that's the one
              hand-off an Android WebView can always honour. Outside MiniPay —
              desktop, mobile Safari/Chrome — a new tab is the better behaviour
              and works fine, so we keep it there. */}
          <a
            href={TELEGRAM_URL}
            target={inMiniPay ? undefined : "_blank"}
            rel={inMiniPay ? undefined : "noopener noreferrer"}
            className="mt-5 flex items-center justify-center px-4 py-3 rounded-xl bg-teal text-white font-display text-sm tracking-wider uppercase"
          >
            {t.supportOpenTelegram}
          </a>

          {/* Fallback for the case this component exists to survive: if the
              hand-off above still doesn't land, the user copies the link and
              opens Telegram themselves. */}
          <button
            onClick={copyLink}
            className="w-full mt-3 text-center text-[11px] font-display tracking-widest uppercase text-muted hover:text-ink py-2"
          >
            {copied ? t.copied : t.supportCopyLink}
          </button>

          {/* Shown, not just copied — a link the user can read is a link they
              can retype into a browser if everything else fails. */}
          <p className="mt-1 text-center text-[11px] text-muted break-all">
            {TELEGRAM_URL}
          </p>
        </div>

        <button
          onClick={onClose}
          className="w-full py-3 text-xs font-display tracking-widest uppercase text-muted border-t border-black/5 hover:text-ink"
        >
          {t.close}
        </button>
      </div>
    </div>
  );
}
