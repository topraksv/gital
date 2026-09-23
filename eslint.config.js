// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*", "coverage/*", ".expo/**"],
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
    },
  },
]);
