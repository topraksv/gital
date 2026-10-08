import broadConfig from "./stryker.config.mjs";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The delivery gate's mutation scope, Helix's shape: the domain files a push
 * changed — in source, in its tests or in its recorded floor — measured from
 * the last green run, dealt to the runners the matrix holds.
 * `npm run test:mutation` keeps the whole domain for a local audit.
 *
 * The whole domain on every full gate was the first choice, at 8 min 35 s on
 * GitHub's runner; on 2026-10-02 it took 16 min 19 s, every other job of the
 * run was done in two, and 339 static mutants — each a whole-suite run — were
 * 86% of it by Stryker's own estimate. A file the push did not touch keeps the
 * score it was recorded at, and the ratchet still reads every file it mutates.
 *
 * A full-gate push that changed no domain file mutates the sentinels, so a
 * dependency or config change that breaks the runner — Vitest 5 did, silently
 * — is still found by the push that made it.
 */
const SENTINEL_SCOPE = ["src/domain/feedback.ts", "src/domain/names.ts", "src/domain/shopping.ts"];

/**
 * The `src/` modules a test imports — not those it mocks, which it does not
 * test — by path without extension: a test's name need not be its source's
 * (Helix's mostly are not), and a deleted test has none. Read from the
 * checkout, which is `head` on a runner.
 */
function importedSources(test, cwd) {
  try {
    return [...readFileSync(resolve(cwd, test), "utf8").matchAll(/(?:from\s+|import\(\s*)["'](?:\.\.\/)+(src\/[\w./-]+?)(?:\.[cm]?[jt]sx?)?["']/g)].map((match) => match[1]);
  } catch {
    return [];
  }
}

export function selectMutationScope({ base, head, eventName = "local", cwd = process.cwd() }) {
  if (!base || !head) {
    if (eventName === "push") throw new Error("Missing mutation diff base or head for a push event.");
    return SENTINEL_SCOPE;
  }
  if (/^0+$/.test(base)) throw new Error("Mutation diff base is the zero SHA; refusing a sentinel-only push gate.");
  try {
    const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const paths = git("diff", "--no-renames", "--name-only", `${base}..${head}`).split("\n");
    // A score moves with its file, its tests, or its recorded floor: 581bb68
    // raised wishes.ts's floor and CI mutated the sentinels instead.
    const floors = (ref) => {
      try {
        return JSON.parse(git("show", `${ref}:mutation-baseline.json`)).files ?? {};
      } catch {
        return {};
      }
    };
    const [before, after] = paths.includes("mutation-baseline.json") ? [floors(base), floors(head)] : [{}, {}];
    const changed = new Set([
      ...paths.filter((file) => /^src\/domain\/.*\.ts$/.test(file)),
      ...paths.filter((file) => file.startsWith("tests/")).flatMap((file) => importedSources(file, cwd).map((source) => `${source}.ts`)),
      ...Object.keys(after).filter((file) => before[file] !== after[file]),
    ]);
    const scope = [...changed].filter((file) => /^src\/domain\/.*\.ts$/.test(file) && existsSync(resolve(cwd, file))).sort();
    return scope.length > 0 ? scope : SENTINEL_SCOPE;
  } catch (error) {
    throw new Error(`Mutation diff base could not be resolved; refusing a sentinel-only push gate: ${error}`);
  }
}

/**
 * The part of the scope one runner mutates, when `MUTATION_SHARD` is `k/n`:
 * files dealt largest first to the lightest shard, weighed in bytes, so every
 * runner deals the same hand from the checkout alone.
 */
export function shardOfScope(files, spec, sizeOf) {
  if (!spec) return files;
  const match = /^(\d+)\/(\d+)$/.exec(spec);
  const index = Number(match?.[1]) - 1;
  const count = Number(match?.[2]);
  if (!match || index < 0 || index >= count) throw new Error(`MUTATION_SHARD must be k/n with 1 <= k <= n, got "${spec}".`);
  const shards = Array.from({ length: count }, () => ({ files: [], bytes: 0 }));
  for (const file of [...files].sort((a, b) => sizeOf(b) - sizeOf(a) || a.localeCompare(b))) {
    const lightest = shards.reduce((best, shard) => (shard.bytes < best.bytes ? shard : best));
    lightest.files.push(file);
    lightest.bytes += sizeOf(file);
  }
  return shards[index].files.sort();
}

export default {
  ...broadConfig,
  mutate: shardOfScope(
    selectMutationScope({
      base: process.env.MUTATION_BASE_SHA,
      head: process.env.MUTATION_HEAD_SHA,
      eventName: process.env.MUTATION_EVENT_NAME,
    }),
    process.env.MUTATION_SHARD,
    (file) => statSync(resolve(process.cwd(), file)).size,
  ),
};
