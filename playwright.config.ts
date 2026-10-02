import { defineConfig, devices } from "@playwright/test";

/**
 * The browser suite, Helix's shape: the local-only export
 * (`scripts/export-e2e-web.mjs`) served the way Pages serves it, one browser
 * at a time, in the owner's locale and zone.
 */
export default defineConfig({
  testDir: "./e2e",
  outputDir: "test-results",
  timeout: 60_000,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  // The html report is what `ci.yml` keeps from a failed run, beside the traces.
  reporter: process.env.CI ? [["github"], ["line"], ["html", { open: "never" }]] : "list",
  expect: { timeout: 15_000 },
  use: {
    baseURL: "http://127.0.0.1:4173",
    locale: "tr-TR",
    timezoneId: "Europe/Istanbul",
    colorScheme: "light",
    contextOptions: { reducedMotion: "reduce" },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Pixel 7"], browserName: "chromium" } }],
  webServer: {
    command: "node scripts/serve-web-export.mjs dist-e2e",
    env: { PORT: "4173" },
    url: "http://127.0.0.1:4173/gital/",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
