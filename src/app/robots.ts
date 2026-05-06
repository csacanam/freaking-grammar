import type { MetadataRoute } from "next";

const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || "https://freaking-grammar.vercel.app"
).replace(/\/+$/, "");

// Explicit allow-list for the social-preview crawlers + generic bots.
// Without a robots.txt, Facebook's Sharing Debugger reports a 403 as
// "could be due to a robots.txt block" — even when the deploy is open
// and the curl works. Publishing this file removes the ambiguity (and
// gives Twitterbot / LinkedInBot / Slackbot / Telegram an explicit
// green light too, since OG previews depend on them).
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      // Social/OG-preview scrapers — listed explicitly so debugger tools
      // surface "allowed" instead of guessing.
      { userAgent: "facebookexternalhit", allow: "/" },
      { userAgent: "Facebot", allow: "/" },
      { userAgent: "Twitterbot", allow: "/" },
      { userAgent: "LinkedInBot", allow: "/" },
      { userAgent: "Slackbot", allow: "/" },
      { userAgent: "Slackbot-LinkExpanding", allow: "/" },
      { userAgent: "TelegramBot", allow: "/" },
      { userAgent: "Discordbot", allow: "/" },
      { userAgent: "WhatsApp", allow: "/" },
      // Catch-all for everything else. /api routes are public read-only;
      // the admin endpoints inside /api/admin are gated by CRON_SECRET so
      // crawlers can attempt them but get 401 — no need to disallow.
      { userAgent: "*", allow: "/" },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
