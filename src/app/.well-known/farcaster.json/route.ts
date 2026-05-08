// Farcaster Mini App manifest. Served at /.well-known/farcaster.json so
// Warpcast / Base App can discover and render the app as a mini-app.
//
// Account association: the three base64 strings (header, payload,
// signature) come from Warpcast Developer Tools after signing the
// domain. Set them in Vercel env (server-side, no NEXT_PUBLIC_) so we
// don't leak the signing payload, and the manifest route picks them
// up automatically. If any of the three is missing the field is
// dropped — the manifest still serves and renders, but the app won't
// be eligible for Warpcast Developer Rewards or appear in featured
// surfaces until verified.

// Dynamic rather than static so updates to FARCASTER_ACCOUNT_*
// env vars in Vercel take effect on the next request, not the next
// build. The manifest is fetched once per client per session at most,
// so the cost is negligible.
export const dynamic = "force-dynamic";

// Strip any trailing slash so `${SITE_URL}/foo` never produces a `//`.
// Warpcast's manifest validator rejects URLs with double slashes.
const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || "https://freaking-grammar.vercel.app"
).replace(/\/+$/, "");

export async function GET() {
  const accountAssociation = readAccountAssociation();

  return Response.json({
    ...(accountAssociation && { accountAssociation }),
    miniapp: {
      version: "1",
      name: "nerdos.fun",
      // Subtitle/tagline have hard char limits enforced by Warpcast
      // (tagline must be 30 chars or fewer). Description must avoid
      // these special chars: @, #, $, %, ^, &, *, +, =, /, \, |, ~, «, ».
      // Copy below has been audited against both rules.
      subtitle: "Rewards for curious minds.",
      description:
        "Daily games for nerdos. Rewards for curious minds. Pick the right answer in 5 seconds, build a streak, win the USDT prize. Grammar and Math are live.",
      iconUrl: `${SITE_URL}/icon-1024.png`,
      splashImageUrl: `${SITE_URL}/splash-200.png`,
      splashBackgroundColor: "#68c3a0",
      // Land Farcaster users on the platform picker so they see the full
      // line-up. While Freaking Grammar is the only live game we could
      // shortcut to /grammar, but the picker is the brand surface and
      // adds one tap — worth it for the rebrand.
      homeUrl: SITE_URL,
      heroImageUrl: `${SITE_URL}/opengraph-image`,
      tagline: "Daily games for nerdos.",
      ogTitle: "nerdos.fun",
      ogDescription: "Daily games for nerdos. Rewards for curious minds.",
      ogImageUrl: `${SITE_URL}/opengraph-image`,
      primaryCategory: "games",
      // Warpcast caps this array at 5. Switched from grammar-specific
      // tags to platform-level ones now that the manifest represents
      // nerdos.fun rather than a single game.
      tags: ["games", "daily", "earn", "puzzles", "nerd"],
      noindex: false,
    },
  });
}

function readAccountAssociation():
  | { header: string; payload: string; signature: string }
  | null {
  const header = process.env.FARCASTER_ACCOUNT_HEADER;
  const payload = process.env.FARCASTER_ACCOUNT_PAYLOAD;
  const signature = process.env.FARCASTER_ACCOUNT_SIGNATURE;
  if (!header || !payload || !signature) return null;
  return { header, payload, signature };
}
