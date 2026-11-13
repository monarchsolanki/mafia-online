// Legibility guard: every phase colour keeps its text, icons and controls readable, on the page and on the tinted surfaces
// that components draw over it. Reads the real tokens out of app/globals.css, so a colour change that hurts contrast fails here.
import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const css = readFileSync(path.resolve(import.meta.dirname, "../app/globals.css"), "utf8");
type RGB = [number, number, number];
const hex = (h: string): RGB => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const lum = (c: RGB) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
const ratio = (a: RGB, b: RGB) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const over = (top: RGB, base: RGB, a: number): RGB => [0, 1, 2].map(i => top[i] * a + base[i] * (1 - a)) as RGB;
const grab = (block: string) => { const t: Record<string, RGB> = {}; for (const m of block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)) t[m[1]] = hex(m[2]); return t; };

// the default (dusk) tokens live in :root; every other phase overrides some of them
const rootBlock = css.match(/:root \{([\s\S]*?)\n\}/)![1];
const base = grab(rootBlock);
const ACTS: Record<string, Record<string, RGB>> = { dusk: base };
for (const m of css.matchAll(/:root\[data-act="([a-z-]+)"\]\s*\{([^}]*)\}/g)) ACTS[m[1]] = Object.assign({}, base, grab(m[2]));

describe("phase colours stay legible", () => {
  test("every phase is covered", () => {
    expect(Object.keys(ACTS).sort()).toEqual(["dawn", "day", "dusk", "night", "vote", "win-draw", "win-mafia", "win-solo", "win-town"]);
  });
  for (const [act, t] of Object.entries(ACTS)) {
    const surface = (ink: number) => over(t.ink, t.ground, ink); // what .well, .tile, .btn, .chip, .seg draw: up to 13% ink over the ground
    test(`${act}: primary text`, () => {
      expect(ratio(t.ink, t.ground)).toBeGreaterThanOrEqual(7);
      expect(ratio(t.ink, surface(0.13))).toBeGreaterThanOrEqual(7);
      expect(ratio(t.ground, t.ink)).toBeGreaterThanOrEqual(7); // the primary button: ground text on an ink fill
    });
    test(`${act}: secondary text, on the page and on every tinted surface`, () => {
      expect(ratio(t["ink-2"], t.ground)).toBeGreaterThanOrEqual(5);
      expect(ratio(t["ink-2"], surface(0.13))).toBeGreaterThanOrEqual(4.5);
    });
    test(`${act}: the danger button and the icons`, () => {
      expect(ratio(t["on-blood"], t.blood)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(t.blood, t.ground)).toBeGreaterThanOrEqual(3); // a skull or warning icon on the page
      expect(ratio(t.accent, t.ground)).toBeGreaterThanOrEqual(3); // focus ring, caret
    });
    test(`${act}: the toggle's outline and thumb`, () => {
      expect(ratio(t["ink-2"], t.ground)).toBeGreaterThanOrEqual(3); // off: outlined track and thumb
      expect(ratio(t.ground, t.ink)).toBeGreaterThanOrEqual(3); // on: thumb on the solid track
    });
  }
});

describe("browser dark-mode extensions leave the app alone", () => {
  // Dark Reader and its relatives recolour pages they think are light. On an iPhone it turned the white toggle tracks and the button
  // fills dark, so they vanished into the (already dark) background while the text stayed readable. The documented opt-out is this tag.
  // Next.js drops metadata with an empty value, so the value must not be empty.
  const layout = readFileSync(path.resolve(import.meta.dirname, "../app/layout.tsx"), "utf8");
  test("the root layout sends <meta name=\"darkreader-lock\"> with a non-empty value", () => {
    expect(layout).toMatch(/other:\s*\{[^}]*"darkreader-lock":\s*"[^"]+"/);
  });
});

describe("nothing readable is faded with opacity", () => {
  // a dimmed label on a coloured ground is what made disabled buttons and unavailable targets unreadable
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({ sel: m[1].trim(), body: m[2] }));
  test("no :disabled rule fades", () => {
    const faded = rules.filter(r => /:disabled/.test(r.sel) && /(^|[;\s])opacity\s*:/.test(r.body)).map(r => r.sel);
    expect(faded).toEqual([]);
  });
  test("dead tiles and switches are not faded", () => {
    const faded = rules.filter(r => /\.tile\.dead|\.switch/.test(r.sel) && /(^|[;\s])opacity\s*:/.test(r.body)).map(r => r.sel);
    expect(faded).toEqual([]);
  });
  test("no text colour is a see-through mix of secondary ink", () => {
    // `color: color-mix(in oklab, var(--ink-2) 75%, transparent)` is how placeholders and tab labels fell under 4.5:1 on light screens
    const thin = rules.filter(r => /(^|[;\s])color\s*:\s*color-mix\([^)]*var\(--ink(-2)?\)\s*\d+%\s*,\s*transparent/.test(r.body)).map(r => r.sel);
    expect(thin).toEqual([]);
  });
  test("components do not dim text with an inline opacity", () => {
    const { execSync } = require("node:child_process");
    const hits = execSync(`grep -rn "opacity:" components --include=*.tsx || true`, { cwd: path.resolve(import.meta.dirname, "..") }).toString().trim();
    expect(hits).toBe("");
  });
});
