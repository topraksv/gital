/**
 * The reset link, read on the page it lands on. Helix's `src/auth/recovery.ts`
 * for the link Gital's e-mail carries: with no sender of its own, the project
 * keeps Supabase's template, whose link passes through Auth's verify endpoint
 * and arrives with a recovery session in its fragment. The request asks for no
 * PKCE, so that session opens in whichever browser the mail app picks, not
 * only in the one that asked (`docs/ARCHITECTURE.md`, 2026-09-26 on accounts).
 */

type RecoveryLink =
  | { kind: "session"; accessToken: string; refreshToken: string }
  | { kind: "expired" }
  | { kind: "invalid" };

/** Expo Linking leaves out Router's base path, so the page's address is built here. */
export function recoveryPage(origin: string, baseUrl: string): string {
  const base = `/${baseUrl}`.replace(/\/{2,}/g, "/").replace(/\/$/, "");
  return new URL(`${base}/reset-password`, origin).toString();
}

export const HOSTED_RECOVERY_PAGE = recoveryPage("https://topraksv.github.io", "/gital");

/**
 * Where a reset e-mail sends its link: back to this page on the web, and to
 * the hosted page from a phone, because Expo Go's address changes with the
 * client and cannot be put on Auth's redirect list.
 */
export function recoveryRedirect(web: { origin: string; baseUrl: string } | null): string {
  return web ? recoveryPage(web.origin, web.baseUrl) : HOSTED_RECOVERY_PAGE;
}

/**
 * A session is bearer material, taken only on the exact page this app sends
 * links to: not on another host, route or port, nor under a user name.
 */
export function parseRecoveryLink(url: string | null, page: string): RecoveryLink {
  let parsed: URL;
  let expected: URL;
  try {
    parsed = new URL(url ?? "");
    expected = new URL(page);
  } catch {
    return { kind: "invalid" };
  }
  if (parsed.username || parsed.password || parsed.origin !== expected.origin || parsed.pathname !== expected.pathname) {
    return { kind: "invalid" };
  }
  const params = new URLSearchParams(parsed.search);
  new URLSearchParams(parsed.hash.slice(1)).forEach((value, key) => params.set(key, value));
  if (["error_code", "error_description"].some((key) => /expired/i.test(params.get(key) ?? ""))) return { kind: "expired" };
  if (params.has("error") || params.has("error_code")) return { kind: "invalid" };
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  return accessToken && refreshToken && params.get("type") === "recovery"
    ? { kind: "session", accessToken, refreshToken }
    : { kind: "invalid" };
}
