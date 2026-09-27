/**
 * The Realtime transport, replaced by a statement that Gital has none yet
 * (Helix's `src/sync/realtime-absent.js`).
 *
 * `@supabase/supabase-js` builds a `RealtimeClient` in its constructor whether
 * or not anything subscribes. Metro does not tree-shake, so Helix measured
 * `@supabase/realtime-js` and its socket at 65_134 bytes of the entry chunk
 * for an app that opens no socket; `metro.config.js` substitutes this file.
 *
 * Gital will open one: a shared list is live (SPEC 1.3), and the sharing
 * slice removes this substitution and measures the budget again. Until then
 * `setAuth`, which supabase-js calls by itself, does nothing, and the channel
 * methods throw rather than pretend: a channel that silently never delivers
 * would surface days later as a tick that never arrived.
 */

const UNAVAILABLE =
  "Supabase Realtime is not bundled in Gital yet. metro.config.js substitutes " +
  "src/sync/realtime-absent.js for @supabase/realtime-js; the sharing slice " +
  "removes that substitution and re-measures the web bundle budget.";

export class RealtimeClient {
  setAuth() {}
  /** Honest and empty: there are no channels, and asking is not an error. */
  getChannels() {
    return [];
  }
  channel() {
    throw new Error(UNAVAILABLE);
  }
  removeChannel() {
    throw new Error(UNAVAILABLE);
  }
  removeAllChannels() {
    throw new Error(UNAVAILABLE);
  }
}
