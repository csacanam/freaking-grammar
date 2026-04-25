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
      name: "Freaking Grammar",
      // Subtitle/tagline have hard char limits enforced by Warpcast
      // (tagline must be 30 chars or fewer). Description must avoid
      // these special chars: @, #, $, %, ^, &, *, +, =, /, \, |, ~, «, ».
      // Copy below has been audited against both rules.
      subtitle: "Top streak. Take the prize.",
      description:
        "Pick the right word in 5 seconds. The longest streak each day wins the prize in USDT. English or Spanish.",
      iconUrl: `${SITE_URL}/icon-1024.png`,
      splashImageUrl: `${SITE_URL}/splash-200.png`,
      splashBackgroundColor: "#68c3a0",
      homeUrl: SITE_URL,
      heroImageUrl: `${SITE_URL}/opengraph-image`,
      tagline: "Top streak takes the prize.",
      ogTitle: "Freaking Grammar",
      ogDescription:
        "Longest streak wins. Pick the right word in 5s.",
      ogImageUrl: `${SITE_URL}/opengraph-image`,
      primaryCategory: "games",
      // Warpcast caps this array at 5. Picked the 5 most valuable for
      // discovery: identity (grammar), habit signal (daily), real
      // differentiator vs other miniapps (spanish), unique mechanic
      // (streak), crypto angle (earn).
      tags: ["grammar", "daily", "spanish", "streak", "earn"],
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
