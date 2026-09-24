/**
 * Say why `npm run web` is an export and not Expo's dev server, before the
 * export's wait rather than after it. Helix's. The reason is at the top of
 * `serve-web-export.mjs`; what to re-test is in `docs/ARCHITECTURE.md`.
 * Neither `EXPO_NO_METRO_LAZY` nor `--no-dev --minify` reaches a working page.
 */

const lines = [
  "",
  "  Expo's web dev server cannot bundle this app on the current SDK:",
  "  the SQLite web driver needs a Web Worker, and workers need bundle",
  "  splitting, which the dev server disables outside an export.",
  "",
  "  Starting the export preview instead — same artifact that deploys,",
  "  no fast refresh. Re-run after a change.",
  "",
];

console.log(lines.join("\n"));
