// Generate a social-media image using the real nerdos brand assets.
//
//   node scripts/social-image.mjs docs/social/answer-reveal.json
//   node scripts/social-image.mjs my-piece.json --out ~/Desktop/piece.png
//
// Why a script instead of a design tool: the pieces that work are the ones
// that reuse the ACTUAL product UI — same font file, same colour tokens, same
// card geometry. Rebuilding that by hand in Figma drifts from the app within a
// release or two. Here the font and mascot are read from public/ and the
// palette is parsed out of globals.css, so a brand change flows through.
//
// See docs/social-images.md for the type-scale reasoning and the format guide.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------- formats
// Feed formats only. Width is always 1080 so the type scale below is expressed
// once and holds for both.
//
// There is deliberately no 16:9 here. The type scale is sized so body copy
// survives a phone feed (see docs/social-images.md), and at those sizes the
// layout needs ~1250px of height — a 630px-tall canvas can't hold even one
// card without cropping. A landscape OG image is a genuinely different piece
// (headline-only, no cards) and wants its own template, not a squeezed version
// of this one.
const FORMATS = {
  "4:5": { w: 1080, h: 1350 }, // tallest thing a phone feed will show — default
  "1:1": { w: 1080, h: 1080 }, // square feeds
};

// --------------------------------------------------------------- palette
// Parsed from globals.css so a token change in the app reaches the images.
function palette() {
  const css = fs.readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");
  const out = {};
  for (const m of css.matchAll(/--color-([a-z]+):\s*(#[0-9a-fA-F]{3,8})/g)) {
    out[m[1]] = m[2];
  }
  const missing = ["ink", "muted", "teal", "red"].filter((k) => !out[k]);
  if (missing.length) {
    throw new Error(`globals.css is missing --color-${missing.join(", --color-")}`);
  }
  return out;
}

function dataUri(rel, mime) {
  const b64 = fs.readFileSync(path.join(ROOT, rel)).toString("base64");
  return `data:${mime};base64,${b64}`;
}

// ----------------------------------------------------------------- cards
// Mirrors the reveal cards in src/app/{grammar,math}/game/over/page.tsx. The
// blank marker and the strike/highlight treatment are deliberately identical —
// the whole point is that a player recognises the card.
function cardHtml(card) {
  const label = card.label ?? "Correct answer";
  let body;

  if (card.type === "grammar") {
    const parts = String(card.phrase).split("____");
    body = parts
      .map((part, i) => {
        const blank =
          i < parts.length - 1
            ? `<span class="hl">${card.correct}</span>`
            : "";
        return `<span>${part.trim()}</span>${blank}`;
      })
      .join("");
  } else if (card.type === "math") {
    const glyph = { "+": "+", "-": "−", x: "×", "/": "÷" }[card.op] ?? card.op;
    const decoy =
      card.shown !== undefined && card.shown !== card.trueResult
        ? `<span class="strike">${card.shown}</span>`
        : "";
    body = `<span>${card.left} ${glyph} ${card.right} =</span>${decoy}<span class="hl">${card.trueResult}</span>`;
  } else {
    throw new Error(`unknown card type "${card.type}" (want "grammar" or "math")`);
  }

  // No pick at all = the clock ran out; that's what the app shows too.
  const foot = card.picked
    ? `You tapped <span class="pick">${card.picked}</span>`
    : "You ran out of time";

  return `<div class="card">
      <div class="label">${label}</div>
      <div class="phrase">${body}</div>
      <div class="foot">${foot}</div>
    </div>`;
}

// ------------------------------------------------------------------ page
function buildHtml(cfg) {
  const fmt = FORMATS[cfg.format ?? "4:5"];
  if (!fmt) {
    throw new Error(`unknown format "${cfg.format}" (want ${Object.keys(FORMATS).join(", ")})`);
  }
  const c = palette();
  const font = dataUri("public/BebasNeue.otf", "font/otf");
  const mascot = dataUri("public/mascot.png", "image/png");

  // Everything scales off the canvas width, so one type scale serves every
  // format. The absolute values are chosen from their ON-SCREEN size on a
  // phone, not from how they look on a desktop monitor — see the doc.
  const u = fmt.w / 1080;
  const px = (n) => `${Math.round(n * u)}px`;

  const headline = (Array.isArray(cfg.headline) ? cfg.headline : [cfg.headline])
    .filter(Boolean)
    .join("<br>");
  const cards = (cfg.cards ?? []).map(cardHtml).join("\n    ");

  return `<!doctype html>
<html><head><meta charset="utf-8">
<style>
@font-face{font-family:"Bebas Neue";src:url(${font}) format("opentype");font-weight:400}
*{margin:0;padding:0;box-sizing:border-box}
:root{--ink:${c.ink};--muted:#7b8580;--teal:${c.teal};--red:${c.red};
  --display:"Bebas Neue",system-ui,sans-serif;
  --sans:ui-sans-serif,system-ui,-apple-system,sans-serif}
body{width:${fmt.w}px;height:${fmt.h}px;background:#f2f5f4;font-family:var(--sans);
  color:var(--ink);overflow:hidden;position:relative}
body::before{content:"";position:absolute;inset:0;
  background:radial-gradient(${px(900)} ${px(700)} at 8% -10%, ${c.teal}57, transparent 60%),
             radial-gradient(${px(700)} ${px(620)} at 108% 110%, ${c.purple ?? "#a772b0"}33, transparent 58%)}
.wrap{position:relative;height:100%;padding:${px(cfg.headTop ?? 68)} ${px(66)} ${px(66)};
  display:flex;flex-direction:column}
header{display:flex;align-items:center;gap:${px(22)};margin-bottom:${px(40)}}
header img{width:${px(92)};height:${px(92)}}
.brand{font-family:var(--display);font-size:${px(46)};letter-spacing:.07em;opacity:.8}
h1{font-family:var(--display);font-size:${px(104)};line-height:.94;letter-spacing:.015em}
.sub{font-size:${px(42)};line-height:1.34;color:#55625c;margin-top:${px(26)}}
.cards{display:flex;flex-direction:column;gap:${px(28)};margin-top:${px(42)}}
.card{background:#fff;border:1px solid rgba(0,0,0,.05);border-radius:${px(40)};
  padding:${px(38)} ${px(46)} ${px(30)};box-shadow:0 ${px(11)} 0 0 rgba(0,0,0,.07)}
.label{font-family:var(--display);font-size:${px(31)};letter-spacing:.2em;
  text-transform:uppercase;color:var(--muted);text-align:center;margin-bottom:${px(20)}}
.phrase{font-family:var(--display);font-size:${px(74)};line-height:1.12;text-align:center;
  display:flex;align-items:center;justify-content:center;gap:${px(16)};flex-wrap:wrap}
.hl{background:${c.teal}52;border-radius:${px(16)};padding:${px(4)} ${px(20)}}
.strike{color:var(--red);text-decoration:line-through;opacity:.72}
.foot{border-top:2px solid rgba(0,0,0,.06);margin-top:${px(26)};padding-top:${px(22)};
  text-align:center;font-size:${px(38)};color:var(--muted)}
.foot .pick{font-family:var(--display);color:var(--red);font-size:${px(46)};letter-spacing:.03em}
</style></head>
<body><div class="wrap">
  <header>
    <img src="${mascot}" alt="">
    <div class="brand">${cfg.brand ?? "NERDOS.FUN"}</div>
  </header>
  <h1>${headline}</h1>
  ${cfg.sub ? `<p class="sub">${cfg.sub}</p>` : ""}
  <div class="cards">
    ${cards}
  </div>
</div>
<div id="probe" style="position:fixed;left:0;top:0;opacity:0;font:10px monospace"></div>
<script>
  // Self-check: report where the content actually ends. Estimating this by
  // hand is how you ship a piece with the last card clipped off.
  addEventListener("load", () => {
    const el = document.querySelector(".cards");
    const bottom = el ? Math.round(el.getBoundingClientRect().bottom) : 0;
    document.getElementById("probe").textContent =
      "PROBE|bottom=" + bottom + "|frame=" + document.body.offsetHeight;
  });
</script>
</body></html>`;
}

// ---------------------------------------------------------------- chromium
function findChromium() {
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ];
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) {
    throw new Error(
      "No Chromium-based browser found. Install Chrome or Brave, or add its path to findChromium().",
    );
  }
  return found;
}

function run(bin, args) {
  return execFileSync(bin, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

// -------------------------------------------------------------------- main
const [, , cfgPath, ...rest] = process.argv;
if (!cfgPath) {
  console.error("usage: node scripts/social-image.mjs <config.json> [--out path.png]");
  process.exit(1);
}

const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
const outFlag = rest.indexOf("--out");
const out = path.resolve(
  outFlag !== -1 ? rest[outFlag + 1] : cfg.out ?? "social-image.png",
);
const fmt = FORMATS[cfg.format ?? "4:5"];

const tmpHtml = path.join(
  fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "nerdos-social-")),
  "piece.html",
);
fs.writeFileSync(tmpHtml, buildHtml(cfg));

const chromium = findChromium();
const base = [
  "--headless",
  "--disable-gpu",
  "--hide-scrollbars",
  `--window-size=${fmt.w},${fmt.h}`,
];

// Pass 1 — measure. Catches the one failure mode that actually bites: content
// taller than the canvas, which crops silently in the screenshot.
const dom = run(chromium, [...base, "--virtual-time-budget=4000", "--dump-dom", `file://${tmpHtml}`]);
const probe = dom.match(/PROBE\|bottom=(\d+)\|frame=(\d+)/);
if (probe) {
  const [, bottom, frame] = probe.map(Number);
  const slack = frame - bottom;
  if (slack < 0) {
    console.error(
      `\n  ✗ Content overflows by ${-slack}px (ends at ${bottom}, canvas is ${frame}).\n` +
        `    Drop a card or shorten the copy — do NOT shrink the type, that's the\n` +
        `    whole point of the format. See docs/social-images.md.\n`,
    );
    process.exit(1);
  }
  if (slack < 40) {
    console.warn(`  ! Only ${slack}px of bottom margin — it will look cramped.`);
  } else {
    console.log(`  ✓ fits: ${slack}px of bottom margin`);
  }
} else {
  console.warn("  ! Could not read the layout probe; skipping the overflow check.");
}

// Pass 2 — render at 2x so it stays sharp on retina phones.
fs.mkdirSync(path.dirname(out), { recursive: true });
run(chromium, [...base, "--force-device-scale-factor=2", `--screenshot=${out}`, `file://${tmpHtml}`]);

console.log(`  ✓ ${out}  (${fmt.w * 2}×${fmt.h * 2}, 2x)`);
