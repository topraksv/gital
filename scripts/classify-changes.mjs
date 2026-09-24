#!/usr/bin/env node
/**
 * Decide what a push to main has to prove.
 *
 * The safe error is a slow run: an unrecognised path gets the full gate, and
 * so does a push with no usable base (the first push, a dispatch). Only paths
 * named below may take the light tier.
 *
 * Usage: node scripts/classify-changes.mjs <base-sha> <head-sha>
 *        node scripts/classify-changes.mjs --files a.ts b.ts
 * Writes `key=value` lines to stdout and, when set, to $GITHUB_OUTPUT.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The scripts `ci.yml` runs. Matched by equality, not a pattern: an escaped
 * path in a regex is right until the first name with a `+` in it. A test walks
 * `ci.yml` and fails when a `node scripts/...` it runs is missing here.
 */
export const CI_EXECUTED_SCRIPTS = [
  "scripts/check-lint-ratchet.mjs",
  "scripts/check-web-budget.mjs",
  "scripts/classify-changes.mjs",
];

/** What a record means, what gets written, and what builds or checks the app. */
const HIGH_RISK = [
  /^src\/domain\//,
  /^src\/data\//,
  /^src\/db\//,
  /^supabase\//,
  /^package(-lock)?\.json$/,
  /^\.nvmrc$/,
  /^app\.json$/,
  /^(babel|metro|eslint)\.config\.js$/,
  /^tsconfig\.json$/,
  /^vitest\.config\.mts$/,
  /^lint-baseline\.json$/,
  /^src\/app\/(?:.*\/)?_layout\.tsx$/,
  /^\.github\/workflows\/ci\.yml$/,
];

/** Cannot change the app or what the gate proves about it. */
const NO_APP_IMPACT = [
  /^README\.md$/,
  /^LICENSE$/,
  /^\.gitignore$/,
  /^\.env\.example$/,
  /^AGENTS\.md$/,
  /^CLAUDE\.md$/,
  /^docs\//,
  /^\.claude\//,
];

/** The explicit light-tier allowlist; everything else escalates. */
const KNOWN_LIGHT = [
  /^src\/app\/.*\.tsx$/,
  /^src\/ui\//,
  /^src\/i18n\//,
  /^tests\//,
  /^scripts\//,
  /^assets\//,
  /^\.github\//,
];

const matches = (path, patterns) => patterns.some((pattern) => pattern.test(path));

/** `files` is null when no diff could be taken, and empty when one was. */
export function classify(files) {
  if (files === null) return { full_gate: true, reason: "no diff available; fail-open full gate" };

  const relevant = files.filter((file) => !matches(file, NO_APP_IMPACT));
  if (relevant.length === 0) return { full_gate: false, reason: "no application impact; light gate retained" };

  const escalating = relevant.filter(
    (file) => matches(file, HIGH_RISK) || CI_EXECUTED_SCRIPTS.includes(file) || !matches(file, KNOWN_LIGHT),
  );
  return escalating.length > 0
    ? { full_gate: true, reason: `high risk: ${escalating.slice(0, 5).join(", ")}` }
    : { full_gate: false, reason: "ordinary change; light gate" };
}

const hasBase = (base) => Boolean(base) && !/^0+$/.test(base);

function main() {
  const [first, ...rest] = process.argv.slice(2);
  let files = null;
  if (first === "--files") {
    files = rest;
  } else if (hasBase(first)) {
    try {
      // `--no-renames`: a rename reports only its destination, and a shipped
      // file moved into a no-impact path must still be seen leaving.
      files = execFileSync("git", ["diff", "--no-renames", "--name-only", `${first}..${rest[0] ?? "HEAD"}`], {
        encoding: "utf8",
      })
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    } catch {
      files = null;
    }
  }

  const lines = Object.entries(classify(files)).map(([key, value]) => `${key}=${value}`);
  process.stdout.write(`${lines.join("\n")}\n`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
