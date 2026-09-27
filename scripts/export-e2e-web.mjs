#!/usr/bin/env node
/**
 * The web export the browser suite drives, Helix's: the product's own
 * device-only path, built with no Supabase project, so no test bypass is
 * compiled into the app and nothing reaches the network.
 *
 * `--clear` is load-bearing. Metro's transform cache key does not include
 * EXPO_PUBLIC_* values, so a warm cache ships the real project's URL and key
 * inside this artifact; Helix measured it both ways. `EXPO_NO_DOTENV` stops
 * Expo reloading `.env` over the empty values.
 */
import { spawn } from "node:child_process";
import { copyFile, rm } from "node:fs/promises";

const output = "dist-e2e";
await rm(output, { recursive: true, force: true });

const child = spawn("npx", ["expo", "export", "-p", "web", "--clear", "--output-dir", output], {
  stdio: "inherit",
  env: { ...process.env, EXPO_PUBLIC_SUPABASE_URL: "", EXPO_PUBLIC_SUPABASE_ANON_KEY: "", EXPO_NO_DOTENV: "1" },
});
const code = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", (exit) => resolve(exit ?? 1));
});
if (code !== 0) process.exit(code);

// A deep link boots the app's own shell, as Pages serves it (`ci.yml`).
await copyFile(`${output}/index.html`, `${output}/404.html`);
