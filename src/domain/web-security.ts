/**
 * The web build's Content Security Policy, Helix's (`src/app/+html.tsx`).
 * GitHub Pages sends no headers, so it is a meta tag, and `connect-src` pins
 * the one project the build was made for: a script injected into the page can
 * still run, since the export's inline bootstrap needs `'unsafe-inline'`, but
 * it can send what it read nowhere else.
 *
 * Every picture reaches the page as data — a synced photo is downloaded into a
 * data URI, a product picture is bundled — so `img-src` names no host. Open
 * Food Facts is asked by the phone alone, as the web has no scanner.
 */

/** The one HTTPS Supabase origin a build may reach, or null. Helix's. */
export function trustedSupabaseOrigin(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const plain = !url.username && !url.password && !url.port && url.pathname === "/" && !url.search && !url.hash;
    return url.protocol === "https:" && plain && /^[a-z0-9-]+\.supabase\.co$/i.test(url.hostname) ? url.origin : null;
  } catch {
    return null;
  }
}

export function contentSecurityPolicy(supabaseUrl: string | undefined): string {
  const origin = trustedSupabaseOrigin(supabaseUrl);
  // A host source matches its own scheme only, so live lists' socket is named
  // apart from the HTTPS origin.
  const project = origin ? ` ${origin} ${origin.replace(/^https:/, "wss:")}` : "";
  return [
    "default-src 'self'",
    // Helix's, for the sqlite worker's WebAssembly. Chromium gives a worker
    // loaded by URL the policy of its own response, not this one, and boots
    // without it (measured 2026-09-27); an engine that passes it down does not.
    "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${project}`,
    "worker-src 'self' blob:",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}
