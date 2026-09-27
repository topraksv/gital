/**
 * The brake on checking a password again, Helix's as it stands. Every check
 * is a real sign-in, so hammering it would trip Supabase's login rate limit
 * for the whole account: after `VERIFY_MAX_FAILURES` failures in a row it
 * pauses for `VERIFY_COOLDOWN_MS`.
 *
 * It belongs to one account's streak, not to the device. Helix's first brake
 * had no owner, so five wrong passwords on one account blocked the next
 * account's first attempt with a message untrue for it; keyed to its owner, a
 * brake that belongs to someone else is simply not this account's, on every
 * path that changes who is signed in. Pure, so the whole state is tested.
 */

export const VERIFY_MAX_FAILURES = 5;
export const VERIFY_COOLDOWN_MS = 30_000;

export interface VerificationBrake {
  /** Account the streak belongs to; `null` means no streak is recorded. */
  userId: string | null;
  failures: number;
  /** Epoch ms until which verification is paused. */
  blockedUntil: number;
}

export const IDLE_BRAKE: VerificationBrake = { userId: null, failures: 0, blockedUntil: 0 };

/** A brake only applies to the account that earned it. */
function ownedBy(brake: VerificationBrake, userId: string): boolean {
  return brake.userId === userId;
}

export function isVerificationBlocked(brake: VerificationBrake, userId: string, now: number): boolean {
  return ownedBy(brake, userId) && now < brake.blockedUntil;
}

/**
 * Record a failed attempt. Reaching the limit engages the cooldown and restarts
 * the streak, so the next block needs another full run of failures.
 */
export function recordVerificationFailure(
  brake: VerificationBrake,
  userId: string,
  now: number,
): VerificationBrake {
  // A different owner means the previous streak is irrelevant, not additive.
  const failures = (ownedBy(brake, userId) ? brake.failures : 0) + 1;
  if (failures >= VERIFY_MAX_FAILURES) {
    return { userId, failures: 0, blockedUntil: now + VERIFY_COOLDOWN_MS };
  }
  return { userId, failures, blockedUntil: ownedBy(brake, userId) ? brake.blockedUntil : 0 };
}

/** A correct password clears this account's streak and any pending cooldown. */
export function recordVerificationSuccess(brake: VerificationBrake, userId: string): VerificationBrake {
  return ownedBy(brake, userId) ? IDLE_BRAKE : brake;
}
