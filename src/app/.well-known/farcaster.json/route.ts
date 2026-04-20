// Farcaster Mini App manifest. Served at /.well-known/farcaster.json so
// Warpcast / Base App can discover and render the app as a mini-app.
//
// Account association (`accountAssociation`) is left out on purpose — you
// sign that separately in Warpcast Developer Tools after this manifest is
// reachable. Without it the app still loads but won't appear in discovery.

export const dynamic = "force-static";

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL || "https://freaking-grammar.vercel.app";

export async function GET() {
  return Response.json({
    miniapp: {
      version: "1",
      name: "Freaking Grammar",
      subtitle: "Daily grammar pot",
      description:
        "Tap the right word fastest. Daily pot, one winner per game, 100% to the winner.",
      iconUrl: `${SITE_URL}/mascot.png`,
      splashImageUrl: `${SITE_URL}/mascot.png`,
      splashBackgroundColor: "#68c3a0",
      homeUrl: SITE_URL,
      heroImageUrl: `${SITE_URL}/opengraph-image`,
      tagline: "Daily grammar pot · winner takes all",
      ogTitle: "Freaking Grammar",
      ogDescription: "Daily grammar pot · one winner per game",
      ogImageUrl: `${SITE_URL}/opengraph-image`,
      primaryCategory: "games",
      tags: ["grammar", "daily", "pot", "winner-takes-all"],
      noindex: false,
    },
  });
}
