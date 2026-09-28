/**
 * The web app installs and opens offline under its base (SPEC 11.4, 10.1).
 * The manifest, the worker and the shell each name the base as a literal,
 * since none of them runs through the bundler; a move to another origin
 * (`docs/BACKLOG.md`) that changed `baseUrl` alone would break installing
 * and the offline start without a single failing screen.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

import { contentSecurityPolicy, trustedSupabaseOrigin } from "../../src/domain/web-security";

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
    // The maskable one is its own drawing, with the mark inside the safe zone
    // a launcher's mask never cuts; the plain ones would lose the leaf to it.
    expect(manifest.icons.map((icon: { sizes: string; purpose: string }) => `${icon.sizes} ${icon.purpose}`)).toEqual([
      "192x192 any",
      "512x512 any",
      "512x512 maskable",
    ]);
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

  it("gives a pasted link the brand's card, served under the base by the name it is published as", () => {
    const shell = read("src/app/+html.tsx");
    expect(shell).toContain(`const SITE_URL = "https://topraksv.github.io${base}";`);
    expect(shell).toContain(`const OG_IMAGE = "og-cover.jpg";`);
    const card = readFileSync(join(root, "public/og-cover.jpg"));
    // JPEG's SOF0 marker carries height then width.
    const sof = card.indexOf(Buffer.from([0xff, 0xc0]));
    expect(`${card.readUInt16BE(sof + 7)}x${card.readUInt16BE(sof + 5)}`).toBe("1200x630");
  });
});

/** The worker's own functions, run outside a browser: nothing else in it runs on load. */
function worker(): Record<string, unknown> {
  const context: Record<string, unknown> = { self: { addEventListener: () => {} } };
  runInNewContext(read("public/sw.js"), context);
  return context;
}
const workerPrunable = () => worker().prunable as (paths: string[]) => string[];

describe("the web database", () => {
  // Helix shares the topraksv.github.io origin, and expo-sqlite's pool locks
  // every file in its folder: in one folder, whichever app opened first locked
  // the other out (reproduced 2026-09-28 with both exports on one origin).
  it("lives in a folder of Gital's own, not the one Helix's pool locks", () => {
    expect(JSON.parse(read("package.json")).scripts.postinstall).toBe("node scripts/patch-dependencies.mjs");
    const worker = read("node_modules/expo-sqlite/web/worker.ts");
    expect(worker).toContain("const VFS_NAME_PERSISTENT = 'gital-sqlite';");
  });
});

describe("the offline worker's cache-first rule", () => {
  // A file whose name never changes, served cache-first, is the first copy
  // forever: the old mark's favicon outlived the new one's deploy (2026-09-28).
  it("serves from the cache first only what a build names by its content", () => {
    const hashed = worker().hashed as (path: string) => boolean;
    expect(hashed(`${base}_expo/static/js/web/entry-0f1e2d3c4b5a69788796a5b4c3d2e1f0.js`)).toBe(true);
    expect(hashed(`${base}assets/assets/fonts/Inter_600SemiBold.01a8a409ba37ab3934865fbb212fb2c9.ttf`)).toBe(true);
    for (const path of ["favicon.ico", "icons/icon-192.png", "icons/email-mark.png", "manifest.webmanifest", "og-cover.jpg"]) {
      expect(hashed(`${base}${path}`), path).toBe(false);
    }
  });
});

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

  // A sheet is react-native-web's Modal, which renders beside `#root` rather
  // than in it: scoped to `#root`, not one control in a sheet had the ring.
  it("covers every element Gital lets focus reach, in a sheet too, react-native-web's own outline reset included", async () => {
    const { focusRingCss } = await import("../../src/ui/focus-ring");
    const css = focusRingCss("#000000");
    expect(css).not.toContain("#root");
    for (const target of ["[tabindex]", "[role=button]", "[role=checkbox]", "[role=switch]", "[role=radio]", "[role=tab]", "[role=slider]", "input", "textarea"]) {
      expect(css, target).toContain(`body ${target}:focus-visible`);
    }
  });

  // A sheet moves focus to its title for a screen reader; the title is not a
  // control, and a ring round it on every opening reads as a stray selection.
  it("draws no ring round a heading that took focus", async () => {
    const { focusRingCss } = await import("../../src/ui/focus-ring");
    const css = focusRingCss("#000000");
    expect(css.indexOf("body [role=heading]:focus-visible{outline:none")).toBeGreaterThan(css.indexOf("[tabindex]:focus-visible"));
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

const directive = (policy: string, name: string) => policy.split("; ").find((part) => part.startsWith(`${name} `)) ?? "";

describe("the web build's network boundary", () => {
  it("trusts one HTTPS Supabase project origin and nothing shaped like it", () => {
    expect(trustedSupabaseOrigin("https://project-ref.supabase.co")).toBe("https://project-ref.supabase.co");
    expect(trustedSupabaseOrigin("https://project-ref.supabase.co/")).toBe("https://project-ref.supabase.co");
    for (const raw of [
      undefined,
      "",
      "not a url",
      "http://project-ref.supabase.co",
      "https://other.supabase.co/rest/v1",
      "https://supabase.co.attacker.example",
      "https://user@project-ref.supabase.co",
      "https://project-ref.supabase.co:8443",
      "https://project-ref.supabase.co/?next=x",
      "https://project-ref.supabase.co/#x",
    ])
      expect(trustedSupabaseOrigin(raw)).toBeNull();
  });

  it("lets the page reach its project by HTTPS and by the socket live lists hold", () => {
    const policy = contentSecurityPolicy("https://project-ref.supabase.co");
    expect(directive(policy, "connect-src")).toBe("connect-src 'self' https://project-ref.supabase.co wss://project-ref.supabase.co");
  });

  it("reaches nothing but itself when the build has no project", () => {
    expect(directive(contentSecurityPolicy(undefined), "connect-src")).toBe("connect-src 'self'");
    expect(directive(contentSecurityPolicy("https://evil.example"), "connect-src")).toBe("connect-src 'self'");
  });

  it("draws pictures only from itself and the data a row carries, and frames nothing", () => {
    const policy = contentSecurityPolicy(undefined);
    expect(directive(policy, "img-src")).toBe("img-src 'self' data: blob:");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("frame-src 'none'");
    expect(policy).toContain("base-uri 'self'");
  });
});
