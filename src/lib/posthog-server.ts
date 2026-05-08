// Server-side PostHog fetcher used by /stats. Hits PostHog's HogQL
// endpoint with the project's Personal API Key — DIFFERENT from the
// client-side public token. Returns null when env isn't configured so
// the stats page renders gracefully without the Web Analytics
// section. Each query is cached server-side for 1h via Next's fetch
// revalidate, so /stats stays cheap to render.
//
// Note on hosts: the client-side SDK posts events to `i.posthog.com`
// (us.i.posthog.com / eu.i.posthog.com), but the management/query
// API lives on `posthog.com` (us.posthog.com / eu.posthog.com). They
// are the same project but different subdomains. We default to US
// here; flip POSTHOG_API_HOST if you provisioned the project on EU.

const PROJECT_ID = process.env.POSTHOG_PROJECT_ID;
const API_KEY = process.env.POSTHOG_PERSONAL_API_KEY;
const HOST = (process.env.POSTHOG_API_HOST || "https://us.posthog.com").replace(
  /\/+$/,
  "",
);

const REVALIDATE_SECONDS = 3600; // 1h cache

async function hogQL(query: string): Promise<unknown[][] | null> {
  if (!PROJECT_ID || !API_KEY) return null;
  try {
    const r = await fetch(`${HOST}/api/projects/${PROJECT_ID}/query/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: { kind: "HogQLQuery", query },
      }),
      next: { revalidate: REVALIDATE_SECONDS },
    });
    if (!r.ok) {
      const errText = await r.text().catch(() => "");
      console.warn(
        `posthog query failed: ${r.status} ${errText.slice(0, 200)}`,
      );
      return null;
    }
    const j = (await r.json()) as { results: unknown[][] };
    return j.results ?? [];
  } catch (e) {
    console.warn("posthog query threw:", (e as Error).message);
    return null;
  }
}

export type PostHogStats = {
  visitors7d: number;
  visitors30d: number;
  sessions30d: number;
  countries: Array<{ name: string; code: string | null; visitors: number }>;
  funnel: {
    visitors: number;
    identified: number;
    played: number;
    finished: number;
  };
  devices: Array<{ device: string; visitors: number }>;
  sources: Array<{ source: string; visitors: number }>;
};

export async function fetchPostHogStats(): Promise<PostHogStats | null> {
  if (!PROJECT_ID || !API_KEY) return null;

  // 4 parallel queries instead of 8: combine the simple counters with
  // ClickHouse's `uniqIf` so funnel + visitor counts share one query.
  const [overview, countries, devices, sources] = await Promise.all([
    hogQL(`
      SELECT
        uniqIf(distinct_id, event = '$pageview' AND timestamp > now() - INTERVAL 7 DAY) AS visitors_7d,
        uniqIf(distinct_id, event = '$pageview' AND timestamp > now() - INTERVAL 30 DAY) AS visitors_30d,
        uniq(properties.$session_id) AS sessions_30d,
        uniqIf(distinct_id, event = '$identify' AND timestamp > now() - INTERVAL 30 DAY) AS identified_30d,
        uniqIf(distinct_id, event = 'play_started' AND timestamp > now() - INTERVAL 30 DAY) AS played_30d,
        uniqIf(distinct_id, event = 'play_finished' AND timestamp > now() - INTERVAL 30 DAY) AS finished_30d
      FROM events
      WHERE timestamp > now() - INTERVAL 30 DAY
    `),
    hogQL(`
      SELECT
        properties.$geoip_country_name AS country_name,
        properties.$geoip_country_code AS country_code,
        uniq(distinct_id) AS visitors
      FROM events
      WHERE event = '$pageview'
        AND timestamp > now() - INTERVAL 30 DAY
        AND properties.$geoip_country_name IS NOT NULL
      GROUP BY country_name, country_code
      ORDER BY visitors DESC
      LIMIT 10
    `),
    hogQL(`
      SELECT
        properties.$device_type AS device,
        uniq(distinct_id) AS visitors
      FROM events
      WHERE event = '$pageview'
        AND timestamp > now() - INTERVAL 30 DAY
        AND properties.$device_type IS NOT NULL
      GROUP BY device
      ORDER BY visitors DESC
    `),
    // Acquisition source — merged signal:
    //   1. person.properties.acquisition_source: explicitly set on first
    //      identify when we're inside a mini-app context (farcaster,
    //      telegram, minipay, base) where iframe sandboxing strips
    //      referrer. This is the strongest signal.
    //   2. Otherwise we bucket $initial_referring_domain into recognised
    //      categories so "t.co" and "twitter.com" land in one row instead
    //      of two, and "Direct" gets its own labelled row instead of
    //      showing as null.
    // Buckets cover the channels that actually drive traffic to
    // nerdos.fun today; anything else passes through as the raw domain
    // so we can spot new sources organically.
    hogQL(`
      SELECT
        coalesce(
          person.properties.acquisition_source,
          multiIf(
            properties.$initial_referring_domain LIKE '%t.co%'
              OR properties.$initial_referring_domain LIKE '%twitter.com%'
              OR properties.$initial_referring_domain LIKE '%x.com%', 'twitter',
            properties.$initial_referring_domain LIKE '%t.me%'
              OR properties.$initial_referring_domain LIKE '%telegram%', 'telegram',
            properties.$initial_referring_domain LIKE '%warpcast.com%'
              OR properties.$initial_referring_domain LIKE '%farcaster%', 'farcaster',
            properties.$initial_referring_domain LIKE '%google.%', 'google',
            properties.$initial_referring_domain LIKE '%bing.%', 'bing',
            properties.$initial_referring_domain IS NULL
              OR properties.$initial_referring_domain = '', 'direct',
            properties.$initial_referring_domain
          )
        ) AS source,
        uniq(distinct_id) AS visitors
      FROM events
      WHERE event = '$pageview'
        AND timestamp > now() - INTERVAL 30 DAY
      GROUP BY source
      ORDER BY visitors DESC
      LIMIT 10
    `),
  ]);

  if (!overview) return null;

  const ovRow = overview[0] ?? [];
  const visitors7d = Number(ovRow[0] ?? 0);
  const visitors30d = Number(ovRow[1] ?? 0);
  const sessions30d = Number(ovRow[2] ?? 0);
  const identified30d = Number(ovRow[3] ?? 0);
  const played30d = Number(ovRow[4] ?? 0);
  const finished30d = Number(ovRow[5] ?? 0);

  return {
    visitors7d,
    visitors30d,
    sessions30d,
    countries: (countries ?? []).map((row) => ({
      name: String(row[0] ?? "Unknown"),
      code: row[1] ? String(row[1]) : null,
      visitors: Number(row[2] ?? 0),
    })),
    funnel: {
      visitors: visitors30d,
      identified: identified30d,
      played: played30d,
      finished: finished30d,
    },
    devices: (devices ?? []).map((row) => ({
      device: String(row[0] ?? "unknown"),
      visitors: Number(row[1] ?? 0),
    })),
    sources: (sources ?? []).map((row) => ({
      source: prettySource(row[0]),
      visitors: Number(row[1] ?? 0),
    })),
  };
}

// Title-case known acquisition buckets so the stats panel reads
// uniformly ("Farcaster" instead of "farcaster") while passing unknown
// referrer domains through verbatim ("randomsite.io").
function prettySource(raw: unknown): string {
  if (!raw) return "Direct";
  const s = String(raw);
  switch (s.toLowerCase()) {
    case "direct":    return "Direct";
    case "farcaster": return "Farcaster";
    case "telegram":  return "Telegram";
    case "twitter":   return "Twitter / X";
    case "google":    return "Google";
    case "bing":      return "Bing";
    case "minipay":   return "MiniPay";
    case "base":      return "Base App";
    default:          return s;
  }
}

// ISO alpha-2 country code → emoji flag. Returns empty string when
// the code isn't a valid 2-letter code so it doesn't garble UTF-8.
export function countryFlag(code: string | null): string {
  if (!code || code.length !== 2) return "";
  const A_LATIN = 0x41;
  const A_FLAG = 0x1f1e6;
  const upper = code.toUpperCase();
  const cps = [...upper].map((c) => A_FLAG + (c.charCodeAt(0) - A_LATIN));
  if (cps.some((cp) => cp < A_FLAG || cp > 0x1f1ff)) return "";
  return String.fromCodePoint(...cps);
}
