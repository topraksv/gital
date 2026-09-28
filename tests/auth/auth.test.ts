/**
 * The account's pure rules (SPEC 9.1), Helix's `tests/auth` for Gital: Auth's
 * English errors in Turkish, the previous sign-in, the brake on password
 * checks, and the reset link: Helix's, which reaches the page with its token
 * unspent and is redeemed on save.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { friendlyAuthError } from "../../src/auth/auth-errors";
import { loadPreviousLogin, recordSuccessfulLogin, seedCurrentLogin, startLoginHistory, type LoginHistoryStorage } from "../../src/auth/login-history";
import { HOSTED_RECOVERY_PAGE, parseRecoveryLink, recoveryPage, recoveryRedirect } from "../../src/auth/recovery";
import {
  IDLE_BRAKE,
  isVerificationBlocked,
  recordVerificationFailure,
  recordVerificationSuccess,
  VERIFY_COOLDOWN_MS,
  VERIFY_MAX_FAILURES,
  type VerificationBrake,
} from "../../src/auth/verification-brake";
import { tr } from "../../src/i18n/tr";

function memoryStorage(): LoginHistoryStorage {
  const values = new Map<string, string>();
  return {
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => void values.set(key, value),
    remove: async (key) => void values.delete(key),
  };
}

describe("the previous sign-in", () => {
  it("is the one before this session, across two sign-ins", async () => {
    const storage = memoryStorage();
    expect(await recordSuccessfulLogin(storage, "u1", "2026-09-26T08:00:00.000Z")).toBeNull();
    expect(await recordSuccessfulLogin(storage, "u1", "2026-09-26T10:30:00.000Z")).toBe("2026-09-26T08:00:00.000Z");
    expect(await loadPreviousLogin(storage, "u1")).toBe("2026-09-26T08:00:00.000Z");
  });

  it("starts empty for a new account and is seeded only once for a session already open", async () => {
    const fresh = memoryStorage();
    await startLoginHistory(fresh, "u1", "2026-09-26T08:00:00.000Z");
    expect(await loadPreviousLogin(fresh, "u1")).toBeNull();
    expect(await recordSuccessfulLogin(fresh, "u1", "2026-09-27T09:00:00.000Z")).toBe("2026-09-26T08:00:00.000Z");

    const open = memoryStorage();
    await seedCurrentLogin(open, "u1", "2026-09-26T08:00:00.000Z");
    await seedCurrentLogin(open, "u1", "2026-09-26T09:00:00.000Z");
    expect(await recordSuccessfulLogin(open, "u1", "2026-09-27T10:00:00.000Z")).toBe("2026-09-26T08:00:00.000Z");
  });
});

describe("Auth's errors, in Turkish", () => {
  it("gives each family its own sentence", () => {
    expect(friendlyAuthError("Invalid login credentials")).toBe(tr.auth.errInvalidCredentials);
    expect(friendlyAuthError("User already registered")).toBe(tr.auth.errUserExists);
    expect(friendlyAuthError("Request rate limit reached")).toBe(tr.auth.errRateLimit);
    expect(friendlyAuthError("TypeError: Network request failed")).toBe(tr.auth.errNetwork);
    expect(friendlyAuthError("Failed to fetch")).toBe(tr.auth.errNetwork);
    expect(friendlyAuthError("Password should be at least 8 characters")).toBe(tr.auth.errWeakPassword);
    expect(friendlyAuthError("Email not confirmed")).toBe(tr.auth.errEmailNotConfirmed);
    expect(friendlyAuthError("Email address not authorized")).toBe(tr.auth.errEmailDelivery);
    expect(friendlyAuthError("Error sending recovery email")).toBe(tr.auth.errEmailDelivery);
    // What Auth answers a sign-up when its SMTP refuses, measured on the live project 2026-09-28.
    expect(friendlyAuthError("Error sending confirmation email")).toBe(tr.auth.errEmailDelivery);
    expect(friendlyAuthError("Error sending email change email")).toBe(tr.auth.errEmailDelivery);
    expect(friendlyAuthError("Unable to validate email address: invalid format")).toBe(tr.auth.errInvalidEmail);
  });

  it("names an ended session and a server failure rather than falling back", () => {
    expect(friendlyAuthError("Invalid Refresh Token: Refresh Token Not Found")).toBe(tr.auth.errSessionExpired);
    expect(friendlyAuthError("JWT expired")).toBe(tr.auth.errSessionExpired);
    // Auth's same-password refusal says "password should be", which the
    // weak-password rule would otherwise claim.
    expect(friendlyAuthError("New password should be different from the old password.")).toBe(tr.auth.errSamePassword);
    expect(friendlyAuthError("same_password")).toBe(tr.auth.errSamePassword);
    expect(friendlyAuthError("Internal Server Error")).toBe(tr.auth.errService);
    expect(friendlyAuthError("Error 503: Service Unavailable")).toBe(tr.auth.errService);
    expect(friendlyAuthError("something unexpected")).toBe(tr.auth.errGeneric);
  });
});

describe("the brake on password checks", () => {
  const A = "user-a";
  const B = "user-b";
  const T0 = 1_000_000;
  const fail = (brake: VerificationBrake, userId: string, count: number) => {
    let next = brake;
    for (let i = 0; i < count; i++) next = recordVerificationFailure(next, userId, T0);
    return next;
  };

  it("stops an account for the cooldown after its run of failures, and a success clears it", () => {
    expect(isVerificationBlocked(fail(IDLE_BRAKE, A, VERIFY_MAX_FAILURES - 1), A, T0)).toBe(false);
    const engaged = fail(IDLE_BRAKE, A, VERIFY_MAX_FAILURES);
    expect(isVerificationBlocked(engaged, A, T0 + VERIFY_COOLDOWN_MS - 1)).toBe(true);
    expect(isVerificationBlocked(engaged, A, T0 + VERIFY_COOLDOWN_MS)).toBe(false);
    // The streak restarts once engaged: the next block needs a whole run.
    expect(isVerificationBlocked(recordVerificationFailure(engaged, A, T0 + VERIFY_COOLDOWN_MS), A, T0 + VERIFY_COOLDOWN_MS)).toBe(false);
    expect(recordVerificationSuccess(engaged, A)).toEqual(IDLE_BRAKE);
  });

  it("belongs to the account that earned it", () => {
    const engaged = fail(IDLE_BRAKE, A, VERIFY_MAX_FAILURES);
    expect(isVerificationBlocked(engaged, B, T0)).toBe(false);
    const bFirst = recordVerificationFailure(fail(IDLE_BRAKE, A, VERIFY_MAX_FAILURES - 1), B, T0);
    expect(bFirst).toEqual({ userId: B, failures: 1, blockedUntil: 0 });
    expect(isVerificationBlocked(recordVerificationSuccess(engaged, B), A, T0)).toBe(true);
  });
});

describe("the reset link", () => {
  const page = recoveryPage("https://topraksv.github.io", "/gital");
  const session = "access_token=access&expires_in=3600&refresh_token=refresh&token_type=bearer&type=recovery";

  it("lands on the hosted page from a phone, and on this page's own address on the web", () => {
    expect(page).toBe(HOSTED_RECOVERY_PAGE);
    expect(HOSTED_RECOVERY_PAGE).toBe("https://topraksv.github.io/gital/reset-password");
    expect(recoveryRedirect(null)).toBe(HOSTED_RECOVERY_PAGE);
    expect(recoveryRedirect({ origin: "https://example.com", baseUrl: "/nested//path/" })).toBe("https://example.com/nested/path/reset-password");
    expect(recoveryRedirect({ origin: "http://localhost:8081", baseUrl: "" })).toBe("http://localhost:8081/reset-password");
  });

  it("holds an unspent recovery token, and only a recovery one", () => {
    expect(parseRecoveryLink(`${page}?token_hash=abc&type=recovery`, page)).toEqual({ kind: "tokenHash", tokenHash: "abc" });
    expect(parseRecoveryLink(`${page}?token_hash=abc&type=signup`, page)).toEqual({ kind: "invalid" });
    expect(parseRecoveryLink(`${page}?token_hash=abc`, page)).toEqual({ kind: "invalid" });
    expect(parseRecoveryLink(`https://evil.example/gital/reset-password?token_hash=abc&type=recovery`, page)).toEqual({ kind: "invalid" });
  });

  // Links already in an inbox from before the template moved.
  it("takes the recovery session from the fragment, whole and only for recovery", () => {
    expect(parseRecoveryLink(`${page}#${session}`, page)).toEqual({ kind: "session", accessToken: "access", refreshToken: "refresh" });
    for (const fragment of ["access_token=a&type=recovery", "refresh_token=r&type=recovery", session.replace("recovery", "signup"), session.replace("&type=recovery", "")]) {
      expect(parseRecoveryLink(`${page}#${fragment}`, page), fragment).toEqual({ kind: "invalid" });
    }
    // Gital asks for no PKCE reset, so a code is nobody's to redeem here.
    expect(parseRecoveryLink(`${page}?code=one-time`, page)).toEqual({ kind: "invalid" });
  });

  it("tells an expired link from any other refusal, and an error beats a session beside it", () => {
    expect(parseRecoveryLink(`${page}#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`, page)).toEqual({ kind: "expired" });
    expect(parseRecoveryLink(`${page}?error_description=OTP+expired`, page)).toEqual({ kind: "expired" });
    expect(parseRecoveryLink(`${page}#error=access_denied&${session}`, page)).toEqual({ kind: "invalid" });
    expect(parseRecoveryLink(`${page}#error_code=bad_jwt`, page)).toEqual({ kind: "invalid" });
    expect(parseRecoveryLink(page, page)).toEqual({ kind: "invalid" });
  });

  it("is refused anywhere but the exact page", () => {
    for (const url of [
      `https://evil.example/gital/reset-password#${session}`,
      `https://topraksv.github.io/reset-password#${session}`,
      `https://topraksv.github.io/gital/other#${session}`,
      `https://topraksv.github.io:8443/gital/reset-password#${session}`,
      `https://user:secret@topraksv.github.io/gital/reset-password#${session}`,
      `javascript://topraksv.github.io/gital/reset-password#${session}`,
      "not a URL",
      null,
    ]) {
      expect(parseRecoveryLink(url, page), String(url)).toEqual({ kind: "invalid" });
    }
    expect(parseRecoveryLink(`${page}#${session}`, "not a page")).toEqual({ kind: "invalid" });
  });
});

describe("the server's account settings", () => {
  const config = readFileSync(join(import.meta.dirname, "../../supabase/config.toml"), "utf8");

  it("asks for a strong password, the current one to change it, and a confirmed address", () => {
    expect(config).toMatch(/^minimum_password_length = 8$/m);
    expect(config).toMatch(/^secure_password_change = true$/m);
    expect(config).toMatch(/\[auth\.email\][\s\S]*?^enable_confirmations = true$/m);
  });

  it("lets the reset link come back to the hosted page", () => {
    expect(config).toContain(`"${HOSTED_RECOVERY_PAGE}"`);
  });

  // Helix's template: the token reaches the page unspent, where a mail
  // client's link checker cannot spend it, and lives five minutes.
  it("mails a reset link that carries its token to the page, for five minutes", () => {
    expect(config).toMatch(/^otp_expiry = 300$/m);
    expect(config).toMatch(/\[auth\.email\.template\.recovery\][\s\S]*?^content_path = "\.\/supabase\/templates\/recovery\.html"$/m);
    const template = readFileSync(join(import.meta.dirname, "../../supabase/templates/recovery.html"), "utf8");
    expect(template).toContain('href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery"');
    expect(template).not.toContain("{{ .ConfirmationURL }}");
    expect(template).not.toMatch(/Helix/);
  });

  it("lets a signed-in account delete itself and nothing else", () => {
    const sql = readFileSync(join(import.meta.dirname, "../../supabase/migrations/00000000000002_delete_own_account.sql"), "utf8");
    expect(sql).toMatch(/function public\.delete_own_account\(\)\s+returns void/);
    expect(sql).toMatch(/security definer\s+set search_path = ''/);
    expect(sql).toMatch(/delete from auth\.users where id = auth\.uid\(\);/);
    expect(sql).toMatch(/revoke all on function public\.delete_own_account\(\) from public, anon, authenticated, service_role;/);
    expect(sql.match(/^grant .*$/gm)).toEqual(["grant execute on function public.delete_own_account() to authenticated;"]);
  });
});

// On web the key-value store is `localStorage`, which any script on the origin
// reads. CodeQL flags its writer because the id and address `signInWithPassword`
// returns land there; session material stays in supabase-js. Helix dismissed
// the same alert and pinned the boundary with this sweep, so it is asserted
// rather than re-argued.
describe("the device's key-value store", () => {
  it("holds only named, non-secret keys", () => {
    const src = join(process.cwd(), "src");
    const sources = readdirSync(src, { recursive: true }).map(String).filter((name) => /\.tsx?$/.test(name)).map((name) => join(src, name));
    const keys = sources.flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(/kv\.set\(\s*([^,]+),/g)].map((match) => match[1]!.trim()),
    );
    // An empty sweep would pass everything below.
    expect(keys.length).toBeGreaterThanOrEqual(10);
    for (const key of keys) {
      expect(key).not.toMatch(/token|password|secret|credential|jwt|session/i);
      expect(key).toMatch(/^("gital\.[\w.-]+"|[A-Z][A-Z0-9_]*_KEY|(APPEARANCE_)?KEYS\.\w+)$/);
    }
  });
});
