import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      // The layers that decide what a record means or what gets written. A
      // glob rather than a list: a new file there is gated the day it lands,
      // with nobody having to remember to add it. Screens and tokens are not
      // here — their rules are owned by contract tests, not by line counts.
      include: ["src/domain/**/*.ts", "src/data/**/*.ts"],
      reportsDirectory: "coverage",
      reporter: ["text", "json-summary"],
      thresholds: {
        perFile: true,
        branches: 90,
        functions: 100,
        lines: 95,
        statements: 90,
      },
    },
  },
});
