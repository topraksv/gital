/**
 * supabase-js's Realtime transport, replaced by a statement that it has none
 * (Helix's `src/sync/realtime-absent.js`).
 *
 * `@supabase/supabase-js` builds a `RealtimeClient` in its constructor whether
 * or not anything subscribes. Metro does not tree-shake, so Helix measured
 * `@supabase/realtime-js` and its socket at 65_134 bytes of the entry chunk;
 * `metro.config.js` substitutes this file for supabase-js's import alone.
 *
 * Gital's live lists open their own client, loaded when first needed
 * (`src/sync/live.ts`). Here `setAuth`, which supabase-js calls by itself,
 * does nothing, and the channel methods throw rather than pretend: a channel
 * that silently never delivers would surface days later as a tick that never
 * arrived.
 */

const UNAVAILABLE =
  "supabase.channel() is not bundled in Gital. metro.config.js substitutes " +
  "src/sync/realtime-absent.js for supabase-js's @supabase/realtime-js; " +
  "open a channel through src/sync/live.ts.";

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
