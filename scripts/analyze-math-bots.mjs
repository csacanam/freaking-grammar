// Read-only bot-behavior review for the MATH game.
//
// The heuristic in src/lib/bot-detection.ts is nominally per-game, but the
// sweep-bots comment says Math is hard because its timing distribution is
// compressed by the tight clock. This script just SURFACES the raw signals
// for every recent Math player so a human can eyeball them:
//
//   - correctRate over answered (q_index > 0)
//   - p50 / p90 response time (ms), min, and a coarse histogram
//   - fastCount (<500ms) and share
//   - sampleSize (timed answers)
//   - already on bot_wallets? (blacklisted)
//
// Nothing is written. Pure diagnostic. Tune LOOKBACK_DAYS / MIN_SAMPLE below.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const SUPA = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const LOOKBACK_DAYS = Number(process.argv[2] ?? 30);
const MIN_SAMPLE = Number(process.argv[3] ?? 20);
const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString();

// Paginated pull — Supabase caps at 1000 rows/request.
async function fetchAllPaged(build) {
  const out = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await build(from, from + page - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < page) break;
  }
  return out;
}

console.log(
  `\nMath bot review — last ${LOOKBACK_DAYS}d, min ${MIN_SAMPLE} timed answers\n`,
);

// bot_wallets blacklist for cross-reference
const { data: blk } = await SUPA.from("bot_wallets").select("player,reason");
const black = new Map((blk ?? []).map((r) => [r.player.toLowerCase(), r.reason]));

const rows = await fetchAllPaged((from, to) =>
  SUPA.from("run_questions")
    .select(
      "q_index,served_at,answered_at,answer_correct,runs!inner(player,status,game)",
    )
    .eq("runs.game", "math")
    .neq("runs.status", "open")
    .gt("q_index", 0)
    .gte("served_at", since)
    .range(from, to),
);

console.log(`Pulled ${rows.length} math answer rows.\n`);

const byPlayer = new Map();
for (const r of rows) {
  const p = r.runs.player.toLowerCase();
  let s = byPlayer.get(p);
  if (!s) {
    s = { answered: 0, correct: 0, times: [] };
    byPlayer.set(p, s);
  }
  if (r.answered_at === null) continue;
  s.answered++;
  if (r.answer_correct === true) s.correct++;
  const ms = new Date(r.answered_at).getTime() - new Date(r.served_at).getTime();
  if (ms >= 0 && ms <= 10_000) s.times.push(ms);
}

const pct = (arr, p) => (arr.length ? arr[Math.floor(arr.length * p)] : null);
const stdev = (arr) => {
  const m = arr.reduce((s, n) => s + n, 0) / arr.length;
  return Math.sqrt(arr.reduce((s, n) => s + (n - m) ** 2, 0) / arr.length);
};

const report = [];
for (const [player, s] of byPlayer) {
  if (s.times.length < MIN_SAMPLE) continue;
  s.times.sort((a, b) => a - b);
  const correctRate = s.answered ? s.correct / s.answered : 0;
  const p10 = pct(s.times, 0.1);
  const p50 = pct(s.times, 0.5);
  const p90 = pct(s.times, 0.9);
  const iqr = p90 - p10; // spread — humans are wide, bots are tight
  const cv = stdev(s.times) / p50; // relative spread (coeff of variation)
  report.push({
    player,
    n: s.times.length,
    correctRate,
    p50,
    iqr,
    relSpread: iqr / p50,
    cv,
    min: s.times[0],
    blacklisted: black.get(player) ?? "",
  });
}

// The math tell is TIGHTNESS at high accuracy, not absolute speed (the
// server timing floor puts everyone > ~1.1s, so the heuristic's p50<800ms
// gate never fires here). Rank accurate players (>=90%) by how tight their
// relative spread is: tightest = most botlike.
report.sort((a, b) => {
  const acc = 0.9;
  const sa = (a.correctRate >= acc ? 1 : 0) - a.relSpread;
  const sb = (b.correctRate >= acc ? 1 : 0) - b.relSpread;
  return sb - sa;
});

console.log(
  "player".padEnd(44),
  "n".padStart(4),
  "acc%".padStart(6),
  "p50".padStart(5),
  "IQR".padStart(5),
  "rel".padStart(5),
  "cv".padStart(5),
  "min".padStart(5),
  "flag",
);
console.log("-".repeat(100));
for (const r of report) {
  console.log(
    r.player.padEnd(44),
    String(r.n).padStart(4),
    (r.correctRate * 100).toFixed(1).padStart(6),
    String(r.p50).padStart(5),
    String(r.iqr).padStart(5),
    r.relSpread.toFixed(2).padStart(5),
    r.cv.toFixed(2).padStart(5),
    String(r.min).padStart(5),
    r.blacklisted ? `🚫 ${r.blacklisted}` : "",
  );
}

console.log(
  `\n${report.length} players with ≥${MIN_SAMPLE} timed math answers.`,
);
console.log(
  `Already blacklisted (any reason): ${[...black.keys()].length} wallets total.\n`,
);
console.log(
  "Read the top rows: high acc% + low p50 + tight p10→p90 + high fast% = botlike.\n",
);
