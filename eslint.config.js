// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    // Deno's, with remote imports the app's toolchain cannot resolve.
    ignores: ["dist/*", "dist-e2e/*", "test-results/*", "reports/*", "coverage/*", ".expo/**", "supabase/functions/**"],
  },
  {
    files: ["scripts/**/*.mjs", ".claude/**/*.mjs"],
    languageOptions: {
      globals: { process: "readonly", console: "readonly", URL: "readonly" },
    },
  },
  {
    // A signal, not a gate: "warn" never fails `expo lint`, and the ratchet in
    // `scripts/check-lint-ratchet.mjs` is what stops the count growing. Raise a
    // file to "error" once its real complexity has been read and settled.
    files: ["src/**/*.ts", "src/**/*.tsx"],
    rules: {
      complexity: ["warn", 15],
      // A component the React Compiler cannot lower is left unmemoised without
      // a word: a `finally`, or a conditional inside `try`, cost thirteen
      // screens theirs (devil round 2026-10-09-2).
      "react-hooks/todo": "error",
      "react-hooks/unsupported-syntax": "error",
    },
  },
]);
