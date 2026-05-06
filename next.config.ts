import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Backward-compat for the days when Freaking Grammar lived at the root
  // (no /grammar prefix). Anyone with a bookmarked /game?tx=... or
  // /history?game=es link still lands inside the game. Permanent so
  // search engines + Farcaster's preview cache update too. The bare /
  // is intentionally not redirected — that route now serves the
  // platform picker.
  async redirects() {
    return [
      { source: "/game", destination: "/grammar/game", permanent: true },
      {
        source: "/game/:path*",
        destination: "/grammar/game/:path*",
        permanent: true,
      },
      { source: "/history", destination: "/grammar/history", permanent: true },
    ];
  },
};

export default nextConfig;
