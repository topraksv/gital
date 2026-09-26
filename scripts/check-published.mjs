#!/usr/bin/env node
/**
 * Ask what was actually published, rather than whether a request succeeded.
 * Ported from Helix on 2026-09-26, the web half only: its `ota` and `expo-go`
 * checks land with the phone deploy.
 *
 *   node scripts/check-published.mjs entry <export-dir>
 *   node scripts/check-published.mjs web <base-url> --entry <path> [--wait <seconds>]
 *
 * `entry` prints the export's entry bundle as `path=…`, for $GITHUB_OUTPUT.
 * That name is a content hash, so no other build carries it, and `web` asks
 * the live site for exactly that name with the same code. A 200 would not do:
 * Pages answers 200 with the previous deploy while a new one propagates, and a
 * half-published artifact answers 200 for a shell whose bundle is gone.
 */
import { appendFileSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The entry bundle a page references, as a path below the site's base. */
export function entryOf(html) {
  return /\/_expo\/static\/js\/web\/entry-[\w-]+\.js/.exec(html)?.[0] ?? null;
}

/**
 * The version the app config inside a bundle declares. Expo embeds that
 * config as a JSON string, so every quote in it arrives escaped: backslashes
 * go first. The version is read from the object that carries the app's own
 * slug — `[^{}]` keeps both keys in one object — because a library in the
 * same bundle may declare a version of its own.
 */
export function appVersionOf(bundle, slug) {
  // Holding the slug to a URL-safe word lets it sit in a pattern unescaped.
  if (!/^[a-z0-9-]+$/i.test(slug)) throw new Error(`not an Expo slug: ${slug}`);
  const flat = bundle.replaceAll("\\", "");
  const after = new RegExp(`"slug":"${slug}"[^{}]*?"version":"(\\d+\\.\\d+\\.\\d+)"`).exec(flat);
  const before = new RegExp(`"version":"(\\d+\\.\\d+\\.\\d+)"[^{}]*?"slug":"${slug}"`).exec(flat);
  return after?.[1] ?? before?.[1] ?? null;
}

const fail = (message) => {
  console.log(`::error::${message}`);
  process.exitCode = 1;
};

const pause = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds));

/** A network error is asked again; an HTTP status is an answer and returned as one. */
async function get(url) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetch(url, { redirect: "follow" });
      return { status: response.status, body: await response.text() };
    } catch (error) {
      if (attempt === 3) throw error;
      await pause(5_000);
    }
  }
}

async function checkWeb(base, { expected, waitSeconds, version, slug }) {
  const site = base.replace(/\/+$/, "");
  const deadline = Date.now() + waitSeconds * 1_000;
  let shell = await get(`${site}/`);
  let entry = shell.status === 200 ? entryOf(shell.body) : null;
  while (entry !== expected && Date.now() < deadline) {
    console.log(`the site still serves ${entry ?? `HTTP ${shell.status}`}; asking again`);
    await pause(15_000);
    shell = await get(`${site}/`);
    entry = shell.status === 200 ? entryOf(shell.body) : null;
  }
  if (shell.status !== 200) return fail(`${site}/ answered HTTP ${shell.status}`);
  if (entry !== expected) return fail(`production serves ${entry ?? "no entry bundle"} after ${waitSeconds}s of asking; this run built ${expected}`);
  const bundle = await get(`${site}${entry}`);
  if (bundle.status !== 200) return fail(`the shell references ${entry} and the site answers HTTP ${bundle.status} for it`);
  const served = appVersionOf(bundle.body, slug);
  if (served !== version) return fail(`production is not serving ${version}: the live bundle declares ${served ?? "no app version"}`);
  // A static route below the root, so a publication that carried only the
  // shell is caught too.
  const route = await get(`${site}/history`);
  if (route.status !== 200) return fail(`${site}/history answered HTTP ${route.status}`);
  console.log(`production serves ${entry}, declaring ${version}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Web publication\n\nProduction serves \`${expected}\`, declaring ${version}\n`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const [command, target] = args;
  const option = (name) => (args.includes(name) ? (args[args.indexOf(name) + 1] ?? "") : undefined);

  if (command === "entry" && target) {
    const entry = entryOf(readFileSync(join(target, "index.html"), "utf8"));
    if (!entry) throw new Error(`${target}/index.html references no entry bundle`);
    process.stdout.write(`path=${entry}\n`);
  } else if (command === "web" && target && option("--entry")) {
    const { version, slug } = JSON.parse(readFileSync("app.json", "utf8")).expo;
    await checkWeb(target, { expected: option("--entry"), waitSeconds: Number(option("--wait") ?? 0), version, slug });
  } else {
    console.error("usage: check-published.mjs entry <dir> | web <base-url> --entry <path> [--wait <seconds>]");
    process.exitCode = 1;
  }
}

// An unreachable site or an unreadable answer is a finding with a sentence, not
// a stack trace: "the site is down" and "the site is stale" need different work.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main().catch((error) => fail(`could not complete the check: ${error.message}`));
}
