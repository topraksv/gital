/**
 * What `expo-sqlite` resolves to while a page is rendered on the server.
 *
 * `metro.config.js` substitutes it for the `node` and `react-server`
 * environments. A server render has no OPFS, no origin and no user, and the
 * root layout draws nothing that reads data until the database has opened in an
 * effect, which server rendering never runs. So the driver is unreachable
 * there, and these are the only runtime imports the app makes from it.
 *
 * Each throws rather than returning nothing: a server render that reaches the
 * database is a screen reading data outside the gate, and should fail at the
 * call instead of building a page from nothing. The listener is the exception —
 * a subscription made on mount must be removable, and there is nothing to hear.
 *
 * Nothing imports this file; Metro's resolver hands it back in place of a
 * package name, which is why `knip.json` ignores it by path. Deleting it puts
 * the driver back into every server render (Helix, `src/db/expo-sqlite.server.js`).
 */

function unavailable(name) {
  return () => {
    throw new Error(
      `expo-sqlite.${name} was called during server rendering, where there is no database. ` +
        "A screen is reading data before the root layout's database gate.",
    );
  };
}

export const openDatabaseAsync = unavailable("openDatabaseAsync");

export function addDatabaseChangeListener() {
  return { remove() {} };
}
