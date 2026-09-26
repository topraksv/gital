/**
 * The web app installs and opens offline under its base (SPEC 11.4, 10.1).
 * The manifest, the worker and the shell each name the base as a literal,
 * since none of them runs through the bundler; a move to Gital's own origin
 * (`docs/BACKLOG.md`) that changed `baseUrl` alone would break installing
 * and the offline start without a single failing screen.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..", "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const base = `${JSON.parse(read("app.json")).expo.experiments.baseUrl}/`;
const manifest = JSON.parse(read("public/manifest.webmanifest"));

/** Width and height from a PNG's IHDR chunk. */
function pngSize(path: string): string {
  const bytes = readFileSync(join(root, path));
  return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
}

describe("the installed web app", () => {
  it("starts and stays under the export's base", () => {
    expect(manifest.start_url).toBe(base);
    expect(manifest.scope).toBe(base);
  });

  it("has the icons it declares, at the sizes it declares", () => {
    expect(manifest.icons.map((icon: { sizes: string }) => icon.sizes)).toEqual(["192x192", "512x512"]);
    for (const icon of manifest.icons) {
      expect(icon.src.startsWith(base), icon.src).toBe(true);
      expect(pngSize(`public/${icon.src.slice(base.length)}`)).toBe(icon.sizes);
    }
    expect(pngSize("public/icons/apple-touch-icon.png")).toBe("180x180");
  });

  it("registers a worker scoped to the base, whose offline shell is the base's page", () => {
    const shell = read("src/app/+html.tsx");
    expect(shell).toContain(`register("${base}sw.js",{scope:"${base}"})`);
    expect(shell).toContain(`href="${base}manifest.webmanifest"`);
    expect(read("public/sw.js")).toContain(`const SHELL = "${base}index.html";`);
  });
});

/** The worker's own `prunable`, run outside a browser: nothing else in it runs on load. */
function workerPrunable(): (paths: string[]) => string[] {
  const context: Record<string, unknown> = { self: { addEventListener: () => {} } };
  runInNewContext(read("public/sw.js"), context);
  return context.prunable as (paths: string[]) => string[];
}

describe("the offline worker's prune", () => {
  const code = (n: number) => Array.from({ length: n }, (_, i) => `${base}_expo/static/js/web/entry-${i}.js`);
  const pictures = (n: number) => Array.from({ length: n }, (_, i) => `${base}assets/assets/noto/p${i}.webp`);

  it("keeps the catalogue's pictures however much code piles up", () => {
    const prunable = workerPrunable();
    const stale = prunable([`${base}index.html`, ...code(121), ...pictures(133)]);
    expect(stale).toEqual(code(121));
  });

  it("keeps everything while each kind is under its own cap", () => {
    expect(workerPrunable()([`${base}index.html`, ...code(120), ...pictures(133)])).toEqual([]);
  });
});

describe("the keyboard focus ring", () => {
  it("is drawn by the app in the live palette's focus colour, the default palette's before the app runs", async () => {
    const { FOCUS_PROPERTY, focusRingCss } = await import("../../src/ui/focus-ring");
    const { DEFAULT_PALETTE_ID, PALETTES } = await import("../../src/ui/theme");
    const css = focusRingCss(PALETTES[DEFAULT_PALETTE_ID].light.focus);
    expect(css).toContain(`outline:2px solid var(${FOCUS_PROPERTY},${PALETTES[DEFAULT_PALETTE_ID].light.focus})`);
    expect(read("src/app/+html.tsx")).toContain("focusRingCss(");
    expect(read("src/app/_layout.tsx")).toContain("FOCUS_PROPERTY");
  });

  it("shows for the keyboard only, inside its own box so a card's clipping cannot cut it", async () => {
    const { focusRingCss } = await import("../../src/ui/focus-ring");
    const css = focusRingCss("#000000");
    expect(css).not.toMatch(/:focus[^-]/);
    expect(css).toContain("outline-offset:-2px");
  });

  it("covers every element Gital lets focus reach, react-native-web's own outline reset included", async () => {
    const { focusRingCss } = await import("../../src/ui/focus-ring");
    const css = focusRingCss("#000000");
    for (const target of ["[tabindex]", "[role=button]", "[role=checkbox]", "[role=switch]", "[role=radio]", "[role=tab]", "[role=slider]", "input", "textarea"]) {
      expect(css, target).toContain(`#root ${target}:focus-visible`);
    }
  });

  it("rings the drawn box of a control whose hit area is larger, not the invisible square around it", async () => {
    const { FOCUS_BOX, focusRingCss } = await import("../../src/ui/focus-ring");
    const css = focusRingCss("#000000");
    expect(FOCUS_BOX).toEqual({ dataSet: { focusBox: "true" } });
    const hidden = css.indexOf(":focus-visible:has(> [data-focus-box]){outline:none");
    expect(hidden).toBeGreaterThan(css.indexOf("[role=button]:focus-visible"));
    expect(css).toContain(":focus-visible > [data-focus-box]{outline:2px solid");
  });
});
