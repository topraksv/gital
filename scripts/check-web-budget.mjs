#!/usr/bin/env node
/**
 * Fail when the web export outgrows its measured weight or carries what a
 * public site must not: a source map, a server credential, or — with
 * `--require-supabase-config` — a production bundle without its Supabase
 * configuration.
 *
 * Helix and Gital run this same file; only `limits` and the measurements
 * written above it differ. Metro does not tree-shake, so one convenient import
 * can put a whole library in the entry bundle without a line of app code
 * changing, and a ceiling is the only thing that says so at the commit that
 * did it. Each ceiling is a measurement plus about 1% of slack (fonts exact);
 * moving one is a decision recorded in `docs/HEALTH.md` with the before and
 * after figures, never an edit made to get a push through.
 */
import { readFile, readdir, stat } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const root = process.argv[2] ?? "dist";

// Measured 2026-09-27 with Helix's sign-in, Ayarlar and Hesap ve Güvenlik:
// entry 2_204_921, all JS 2_455_028, export 4_278_580, the CSP repeated in
// each of the export's pages; pictures 324_522 on the catalogue, then
// 341_284 with the brand mark's two layers (16_762, 2026-09-27). The Realtime
// transport is a chunk of its own (67 KB), loaded only by someone sharing a
// list. 2026-09-28, the brand kit: the export 4_337_449, grown by the social
// card, the maskable icon, the mail's mark and the card's tags on every page.
// 2026-09-28, the error screen and the draft guard: all JS 2_484_430, entry
// 2_246_164, 5_986 bytes of Gital's own code and no new library.
// 2026-10-02, 1.7.0: entry 2_304_739, all JS 2_543_005, export 4_424_875;
// the third list's screens, about 37 KB of Gital's own code and 618 bytes of
// expo-system-ui. `docs/HEALTH.md` traces the growth.
// 2026-10-08, this file became Helix's: the same metrics, so fonts, source
// maps and server credentials are bounded here too, and every picture format
// is weighed apart rather than WebP alone. Measured: entry 2_315_088, all JS
// 2_553_353, export without pictures 4_362_520, pictures 397_225, 4 font
// files of 615_272 bytes.
const limits = {
  entryJavaScript: 2_327_700,
  totalJavaScript: 2_568_400,
  totalExport: 4_406_100,
  // The catalogue's hundreds of WebP would otherwise hide a code regression in
  // the total (SPEC 14.1).
  pictureBytes: 401_200,
  fontFiles: 4,
  fontBytes: 621_500,
  // Pages is public. Symbolication maps belong only in a private crash service,
  // if one is approved later; neither map files nor bundle references ship.
  sourceMapFiles: 0,
  sourceMapReferences: 0,
  // Nothing a server holds may reach a public site. See `CREDENTIAL_SHAPES`.
  serverCredentialReferences: 0,
};

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return walk(path);
    if (!entry.isFile()) return [];
    return [{ path, size: (await stat(path)).size }];
  }));
  return nested.flat();
}

const files = await walk(root);
const javaScript = files.filter((file) => extname(file.path) === ".js");
const entry = javaScript.find((file) => /[/\\]entry-[^/\\]+\.js$/.test(file.path));
const fonts = files.filter((file) => [".ttf", ".otf", ".woff", ".woff2"].includes(extname(file.path)));
// Weighed apart from the code: a picture set can grow for a product reason and
// would otherwise hide a code regression inside the total.
const pictures = files.filter((file) => [".webp", ".png", ".jpg", ".jpeg", ".gif", ".avif"].includes(extname(file.path)));
const isPicture = (file) => pictures.includes(file);
const sourceMaps = files.filter((file) => extname(file.path) === ".map");
const sourceMapCandidates = files.filter((file) => [".js", ".css"].includes(extname(file.path)));
const sourceMapReferences = (
  await Promise.all(sourceMapCandidates.map(async (file) => (
    (await readFile(file.path, "utf8")).includes("sourceMappingURL=") ? file : null
  )))
).filter(Boolean);
/**
 * Server credentials, by the shapes their issuers give them.
 *
 * The export is a public site, and the likeliest way a secret reaches it
 * bypasses everything that scans the repository: an `EXPO_PUBLIC_*` value fed
 * from a CI secret or a build environment never passes through a commit, so
 * push protection never sees it. This is the one place that does. A finding
 * names the shape and the file, never the value, because this output is a
 * public log. Measured against the production and E2E exports when this was
 * written: no match, and no JWT-shaped string at all.
 */
const CREDENTIAL_SHAPES = [
  ["Supabase secret key", /\bsb_secret_[\w-]{16,}/],
  ["Supabase access token", /\bsbp_[A-Za-z0-9]{40}\b/],
  ["GitHub token", /\b(?:gh[pousr]_[A-Za-z0-9]{36}|github_pat_\w{40,})\b/],
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----\s+[A-Za-z0-9+/=\s]{64,}/],
];
// A JWT is a leak only when it carries the server role: the legacy anon key is
// a JWT too, and it ships by design.
const carriesServiceRole = (payload) => {
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).role === "service_role";
  } catch {
    return false;
  }
};
const credentialFindings = (
  await Promise.all(files
    .filter((file) => [".js", ".css", ".html", ".json", ".txt", ".xml", ".svg", ".webmanifest"].includes(extname(file.path)))
    .map(async (file) => {
      const body = await readFile(file.path, "utf8");
      const found = CREDENTIAL_SHAPES.filter(([, shape]) => shape.test(body)).map(([name]) => name);
      const jwts = [...body.matchAll(/\beyJ[\w-]{8,}\.(eyJ[\w-]{8,})\.[\w-]{8,}/g)];
      if (jwts.some((match) => carriesServiceRole(match[1]))) found.push("service-role JWT");
      return found.map((name) => `${name} in ${relative(root, file.path)}`);
    }))
).flat();
if (credentialFindings.length > 0) console.error(`Server credentials found: ${credentialFindings.join(", ")}`);
const sum = (items) => items.reduce((total, item) => total + item.size, 0);
const metrics = {
  entryJavaScript: entry?.size ?? 0,
  totalJavaScript: sum(javaScript),
  totalExport: sum(files.filter((file) => !isPicture(file))),
  pictureBytes: sum(pictures),
  fontFiles: fonts.length,
  fontBytes: sum(fonts),
  sourceMapFiles: sourceMaps.length,
  sourceMapReferences: sourceMapReferences.length,
  serverCredentialReferences: credentialFindings.length,
};

for (const [name, value] of Object.entries(metrics)) {
  const limit = limits[name];
  const unit = name.endsWith("Files") || name.endsWith("References") ? "" : " bytes";
  console.log(`${name}: ${value}${unit} (budget ${limit}${unit})`);
  if (value > limit) process.exitCode = 1;
}
if (!entry) {
  console.error(`No Expo entry bundle found under ${relative(process.cwd(), root) || root}`);
  process.exitCode = 1;
}
// Metro's transform cache is shared by `expo export` and `eas update`, and its
// key does not include EXPO_PUBLIC_* values. A cache left behind by the
// local-only E2E export therefore yields a bundle where isSupabaseConfigured is
// false — sign-in and sync silently gone, with nothing in the export, the
// budget or the OTA evidence to show it. `--clear` prevents that; this proves
// it, because remembering a flag is not a control.
// Opt-in, because only a real production export makes this claim. CI puts the
// values in the job environment; locally only Expo reads `.env`, so the check
// reads it too — one that quietly skips itself is the failure mode it exists to
// catch, which is why the skip is printed rather than assumed.
if (entry && process.argv.includes("--require-supabase-config")) {
  if (!process.env.EXPO_PUBLIC_SUPABASE_URL) {
    try {
      process.loadEnvFile(".env");
    } catch {
      // Neither environment nor .env: a local-only build, which is a legitimate
      // configuration with nothing to inline.
    }
  }
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) {
    console.log("supabaseConfigInlined: skipped (no EXPO_PUBLIC_SUPABASE_URL configured)");
  } else {
    let trustedOrigin = null;
    try {
      const parsed = new URL(supabaseUrl);
      if (
        parsed.protocol === "https:" &&
        !parsed.username &&
        !parsed.password &&
        !parsed.port &&
        parsed.pathname === "/" &&
        !parsed.search &&
        !parsed.hash &&
        /^[a-z0-9-]+\.supabase\.co$/i.test(parsed.hostname)
      ) trustedOrigin = parsed.origin;
    } catch {
      // The explicit failure below is the release result.
    }
    console.log(`supabaseOriginTrusted: ${trustedOrigin != null} (expected true)`);
    if (!trustedOrigin) {
      console.error("EXPO_PUBLIC_SUPABASE_URL must be a bare HTTPS Supabase project origin.");
      process.exitCode = 1;
    }
    const inlined = (await readFile(entry.path, "utf8")).includes(supabaseUrl);
    console.log(`supabaseConfigInlined: ${inlined} (expected true)`);
    if (!inlined) {
      console.error("Entry bundle carries no Supabase configuration. Re-export with --clear.");
      process.exitCode = 1;
    }
  }
}
if (sourceMaps.length > 0) {
  console.error(`Public source maps found: ${sourceMaps.map((file) => relative(root, file.path)).join(", ")}`);
}
if (sourceMapReferences.length > 0) {
  console.error(`Public source-map references found: ${sourceMapReferences.map((file) => relative(root, file.path)).join(", ")}`);
}
if (process.exitCode) {
  console.error("Web export exceeds its measured release budget.");
} else {
  console.log("Web export is within its release budget.");
}
