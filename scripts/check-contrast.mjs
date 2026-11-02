#!/usr/bin/env node
// ── Contrast is a gate, not a claim ──────────────────────────────────────────
//
// Every semantic text token must clear 4.5:1 on every surface it is used on, in
// all three appearances, and an accent fill must clear 4.5:1 against the text
// placed on it. The CSS comment says so; this script is what makes it true.
//
// It reads `app/globals.css`, resolves the rgba() tokens over the opaque surface
// beneath them, and exits 1 listing every pair that regressed. No dependencies,
// no browser, no network: a contributor can run it before opening a PR.
//
//   node scripts/check-contrast.mjs
//
// It also refuses a stylesheet that lost its visible focus ring or its
// reduced-motion block, because both are part of the same accessibility gate.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cssPath = join(root, "app", "globals.css");
const css = readFileSync(cssPath, "utf8");

const MIN_RATIO = 4.5;

const THEMES = [
  { name: "dark", selector: ":root" },
  { name: "paper", selector: 'html[data-theme="paper"]' },
  { name: "ink", selector: 'html[data-theme="ink"]' },
];

/** Text tokens, and the surfaces each is rendered on. */
const TEXT_PAIRS = [
  ["text-hi", ["bg", "bg-raised", "card", "chip"]],
  ["text", ["bg", "bg-raised", "card", "chip"]],
  ["text-mid", ["bg", "bg-raised", "card", "chip"]],
  ["text-low", ["bg", "bg-raised", "card", "chip"]],
  ["accent-text", ["bg", "bg-raised", "card", "chip"]],
  ["danger", ["bg", "card", "raised"]],
  ["warn", ["bg", "card", "raised"]],
];

/** Filled pairs: foreground on top of a fill. */
const FILL_PAIRS = [
  ["on-accent", "accent"],
  ["bubble-user-text", "bubble-user"],
];

const NAMED = {
  ...Object.fromEntries(
    ["bg", "bg-raised", "card", "chip", "accent", "accent-soft", "text-hi", "text", "text-mid", "text-low", "danger", "warn", "on-accent", "bubble-user", "bubble-user-text", "accent-text"].map(
      (name) => [name, `--${name}`]
    )
  ),
  raised: "--bg-raised",
};

function blockBody(selector) {
  const start = css.indexOf(selector);
  if (start === -1) return null;

  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  if (open === -1 || close === -1) return null;

  return css.slice(open + 1, close);
}

function readTokens(body) {
  const tokens = {};
  for (const match of body.matchAll(/--([a-z-]+)\s*:\s*([^;]+);/g)) {
    tokens[match[1]] = match[2].trim();
  }
  return tokens;
}

function parseColor(value) {
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const int = Number.parseInt(hex[1], 16);
    return {
      r: (int >> 16) & 255,
      g: (int >> 8) & 255,
      b: int & 255,
      a: 1,
    };
  }

  const rgba = value.match(
    /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+))?\s*\)$/i
  );
  if (rgba) {
    return {
      r: Number(rgba[1]),
      g: Number(rgba[2]),
      b: Number(rgba[3]),
      a: rgba[4] === undefined ? 1 : Number(rgba[4]),
    };
  }

  return null;
}

function over(foreground, background) {
  if (foreground.a >= 1) return foreground;
  const a = foreground.a;
  return {
    r: foreground.r * a + background.r * (1 - a),
    g: foreground.g * a + background.g * (1 - a),
    b: foreground.b * a + background.b * (1 - a),
    a: 1,
  };
}

function channel(value) {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(color) {
  return (
    0.2126 * channel(color.r) +
    0.7152 * channel(color.g) +
    0.0722 * channel(color.b)
  );
}

function ratio(a, b) {
  const l1 = luminance(a);
  const l2 = luminance(b);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

const failures = [];
const summaries = [];

for (const theme of THEMES) {
  const body = blockBody(theme.selector);
  if (!body) {
    failures.push(`${theme.name}: the stylesheet has no ${theme.selector} block`);
    continue;
  }

  const tokens = readTokens(body);

  const resolve = (name) => {
    const value = tokens[name.replace(/^--/, "")];
    return value ? parseColor(value) : null;
  };

  const surface = (name) => resolve(NAMED[name] ?? name);

  let worst = { ratio: Infinity, pair: "—" };

  const check = (label, fgValue, bgValue) => {
    const fg = parseColor(fgValue);
    const bgRaw = parseColor(bgValue);
    if (!fg || !bgRaw) {
      failures.push(`${theme.name}: ${label} does not resolve to a colour`);
      return;
    }

    const bg = over(bgRaw, { r: 255, g: 255, b: 255, a: 1 });
    const blended = over(fg, bg);
    const value = ratio(blended, bg);

    if (value < worst.ratio) worst = { ratio: value, pair: label };
    if (value < MIN_RATIO) {
      failures.push(
        `${theme.name}: ${label} is ${value.toFixed(2)}:1, below ${MIN_RATIO}:1`
      );
    }
  };

  for (const [textName, surfaces] of TEXT_PAIRS) {
    const fg = resolve(textName);
    if (!fg) {
      failures.push(`${theme.name}: no --${textName} token`);
      continue;
    }

    for (const surfaceName of surfaces) {
      const bg = surface(surfaceName);
      if (!bg) {
        failures.push(`${theme.name}: no surface for ${surfaceName}`);
        continue;
      }

      // Resolve the surface first so a translucent chip blends with its canvas.
      const canvas = over(surface("bg"), { r: 255, g: 255, b: 255, a: 1 });
      const resolvedBg = over(bg, canvas);
      const blendedFg = over(fg, resolvedBg);
      const value = ratio(blendedFg, resolvedBg);

      if (value < worst.ratio) worst = { ratio: value, pair: `${textName} on ${surfaceName}` };
      if (value < MIN_RATIO) {
        failures.push(
          `${theme.name}: ${textName} on ${surfaceName} is ${value.toFixed(2)}:1, below ${MIN_RATIO}:1`
        );
      }
    }
  }

  for (const [fgName, bgName] of FILL_PAIRS) {
    const fg = resolve(fgName);
    const bg = resolve(bgName);
    if (!fg || !bg) {
      failures.push(`${theme.name}: missing ${fgName} or ${bgName}`);
      continue;
    }

    const fill = over(bg, parseColor(theme.name === "paper" ? "#ffffff" : "#000000"));
    const value = ratio(over(fg, fill), fill);

    if (value < worst.ratio) worst = { ratio: value, pair: `${fgName} on ${bgName}` };
    if (value < MIN_RATIO) {
      failures.push(
        `${theme.name}: ${fgName} on ${bgName} is ${value.toFixed(2)}:1, below ${MIN_RATIO}:1`
      );
    }
  }

  summaries.push(
    `  ${theme.name.padEnd(6)} ${worst.pair.padEnd(26)} ${worst.ratio.toFixed(2)}:1`
  );
}

if (!/:focus-visible\s*\{/.test(css)) {
  failures.push("globals.css has no :focus-visible ring");
}

if (!/@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(css)) {
  failures.push("globals.css does not honour prefers-reduced-motion");
}

console.log("Contrast — text tokens on their surfaces\n");
for (const line of summaries) console.log(line);
console.log("");

if (failures.length > 0) {
  console.error(`  FAIL ${failures.length} contrast problem(s):`);
  for (const failure of failures) console.error(`    ${failure}`);
  console.error("");
  process.exitCode = 1;
} else {
  console.log(`  Pass — every pair clears ${MIN_RATIO}:1 in all three themes.`);
}
