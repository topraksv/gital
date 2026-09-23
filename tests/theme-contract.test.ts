import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

import { darkPalette, layout, lightPalette, motion, radius, space, type, type Palette } from "../src/ui/theme";

/** WCAG 2.2 relative luminance of a `#RRGGBB` colour. */
function luminance(hex: string): number {
  const [r, g, b] = (hex.match(/[0-9a-f]{2}/gi) ?? []).map((pair) => {
    const c = Number.parseInt(pair, 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

const palettes: [string, Palette][] = [
  ["light", lightPalette],
  ["dark", darkPalette],
];

// SC 1.4.3 for text, SC 1.4.11 for a focus ring against what it sits on.
const TEXT = 4.5;
const NON_TEXT = 3;

describe.each(palettes)("%s palette", (_, p) => {
  it("is written as six-digit hex, so every ratio below is computable", () => {
    for (const value of Object.values(p)) expect(value).toMatch(/^#[0-9A-F]{6}$/);
  });

  it("holds no pure black or pure white", () => {
    for (const value of Object.values(p)) expect(["#000000", "#FFFFFF"]).not.toContain(value);
  });

  it.each([
    ["text", "background", TEXT],
    ["text", "surface", TEXT],
    ["textMuted", "background", TEXT],
    ["textMuted", "surface", TEXT],
    ["onPrimary", "primary", TEXT],
    ["onDestructive", "destructive", TEXT],
    ["focus", "background", NON_TEXT],
    ["focus", "surface", NON_TEXT],
  ] as const)("%s on %s reaches %s:1", (fg, bg, floor) => {
    expect(contrast(p[fg], p[bg])).toBeGreaterThanOrEqual(floor);
  });
});

describe("scales", () => {
  const ascending = (values: number[]) => values.every((v, i) => i === 0 || v > values[i - 1]!);

  it("spacing sits on the 4-point grid and only grows", () => {
    const steps = Object.values(space);
    for (const step of steps) expect(step % 4).toBe(0);
    expect(ascending(steps)).toBe(true);
  });

  it("type sizes only grow, and no line is tighter than 1.2", () => {
    const styles = Object.values(type);
    expect(ascending(styles.map((s) => s.fontSize))).toBe(true);
    for (const s of styles) expect(s.lineHeight).toBeGreaterThanOrEqual(s.fontSize * 1.2);
  });

  it("every named size resolves to a positive finite number", () => {
    for (const value of [...Object.values(radius), ...Object.values(motion), ...Object.values(layout)]) {
      expect(Number.isFinite(value) && value > 0).toBe(true);
    }
  });
});

describe("theme.ts holds the only literals", () => {
  const root = join(import.meta.dirname, "..");
  const sources = (readdirSync(join(root, "src"), { recursive: true }) as string[])
    .filter((file) => /\.tsx?$/.test(file))
    .map((file) => join(root, "src", file))
    .filter((path) => relative(root, path) !== join("src", "ui", "theme.ts"));

  const COLOUR = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\(/i;
  const RAW_SIZE =
    /\b(?:margin|padding|gap|top|bottom|left|right|width|height|fontSize|lineHeight|borderRadius|duration)\w*\s*:\s*-?\d/;

  it("finds source to scan, so an empty glob cannot pass", () => {
    expect(sources.length).toBeGreaterThan(0);
  });

  it.each([
    ["colour", COLOUR],
    ["raw size", RAW_SIZE],
  ])("no %s literal outside src/ui/theme.ts", (_, pattern) => {
    const offenders = sources.flatMap((path) =>
      readFileSync(path, "utf8")
        .split("\n")
        .map((line, i) => (pattern.test(line) ? `${relative(root, path)}:${i + 1}: ${line.trim()}` : null))
        .filter((hit): hit is string => hit !== null),
    );
    expect(offenders).toEqual([]);
  });
});
