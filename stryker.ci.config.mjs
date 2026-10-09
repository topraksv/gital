import broadConfig from "./stryker.config.mjs";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The delivery gate's mutation scope: what a push changed, dealt to the
 * runners `.github/workflows/ci.yml` holds. Helix and Gital run this same
 * file; only the three constants below differ, and each says why it is what
 * it is. `npm run test:mutation` mutates `stryker.config.mjs`'s list, for a local audit.
 *
 * The whole inventory on every gate was the first choice. On 2026-10-02 it
 * took Gital 16 min 19 s while every other job was done in two, and 339 static
 * mutants, each a whole-suite run, were 86% of it. A file the push did not
 * touch keeps the score it was recorded at, and the ratchet reads every file
 * it mutates.
 *
 * The broad break threshold is the one setting not inherited. Applied to
 * whatever a push touched it was unreachable — Helix's first real product diff
 * scored 54.22 against 98 — and a release shipped around it.
 */

// Gital's scope.

/**
 * What a push that changed nothing in scope mutates: three small domain files
 * that every runner reaches in under a minute, enough to prove the runner
 * still kills mutants.
 */
const SENTINEL_SCOPE = ["src/domain/feedback.ts", "src/domain/names.ts", "src/domain/shopping.ts"];

/**
 * Helix's directories (2026-10-08): the domain was Gital's whole scope, so a
 * change to storage, sync, sign-in or a service shipped unmutated. `src/data`
 * here is Helix's `src/data/repo` and its hooks: `hooks.ts` is React glue
 * over it and stays out, as Helix's does.
 */
const MUTATION_RELEVANT = /^src\/(?:domain|data|db|sync|auth|services)\/.*\.(?:[cm]?js|tsx?)$/;

/**
 * Files inside that scope with no logic to mutate, each excluded in Helix for
 * the reason its `stryker.ci.config.mjs` gives: generated migrations, the
 * Drizzle schema whose every mutant is static and tests a mirror of what
 * Postgres enforces, the server-render stand-in for `expo-sqlite` and the
 * resolution of `@supabase/realtime-js` that is a set of throws.
 */
const MUTATION_EXCLUDED = /^src\/(?:db\/(?:migrations\/|schema\.ts$|expo-sqlite\.server\.js$)|data\/hooks\.ts$|sync\/realtime-absent\.js$)/;

// Everything below is the same file in Helix and Gital.

/**
 * Whether a path is inside the gate at all. Exported so the rule can be asked
 * about a file the current change adds, which no committed diff can show yet.
 */
export function isMutationScoped(file) {
  return MUTATION_RELEVANT.test(file) && !MUTATION_EXCLUDED.test(file);
}

/**
 * The `src/` modules a test imports — not those it mocks, which it does not
 * test — by path as written: a test is named for a behaviour, not for its
 * source, and a deleted test has none. Read from the checkout, which is `head`
 * on a runner: a `git show` per test made a long range take seconds.
 */
function importedSources(test, cwd) {
  try {
    return [...readFileSync(resolve(cwd, test), "utf8").matchAll(/(?:from\s+|import\(\s*)["'](?:\.\.\/)+(src\/[\w./-]+?)["']/g)].map((match) => /** @type {string} */ (match[1]));
  } catch {
    return [];
  }
}

/**
 * The files a push changed in source, in a test that imports them, or in
 * their recorded floor, measured from the last green run so a failed run's
 * changes are mutated again. A push that changed none of them mutates the
 * sentinels, so a dependency or config change that breaks the runner —
 * Vitest 5 did, silently — is still found by the push that made it.
 */
export function selectMutationScope({ base, head, eventName = "local", cwd = process.cwd() }) {
  if (!base || !head) {
    if (eventName === "push") throw new Error("Missing mutation diff base or head for a push event.");
    return SENTINEL_SCOPE;
  }
  if (/^0+$/.test(base)) throw new Error("Mutation diff base is the zero SHA; refusing a sentinel-only push gate.");
  try {
    const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const paths = git("diff", "--no-renames", "--name-only", `${base}..${head}`).split("\n").filter(Boolean);
    const tested = paths
      .filter((file) => file.startsWith("tests/"))
      .flatMap((file) => importedSources(file, cwd))
      .flatMap((source) => [source, `${source}.ts`, `${source}.tsx`]);
    // A raised floor is a claim about a file's tests: Gital's 581bb68 raised
    // wishes.ts's and CI mutated the sentinels instead.
    const floors = (ref) => {
      try {
        return JSON.parse(git("show", `${ref}:mutation-baseline.json`)).files ?? {};
      } catch {
        return {};
      }
    };
    const [before, after] = paths.includes("mutation-baseline.json") ? [floors(base), floors(head)] : [{}, {}];
    const refloored = Object.keys(after).filter((file) => before[file]?.score !== after[file]?.score);
    const changed = [...paths, ...tested, ...refloored]
      .filter(isMutationScoped)
      .filter((file) => existsSync(resolve(cwd, file)));
    return changed.length > 0 ? [...new Set(changed)].sort() : SENTINEL_SCOPE;
  } catch (error) {
    throw new Error(`Mutation diff base could not be resolved; refusing a sentinel-only push gate: ${error}`);
  }
}

/**
 * The part of the scope one runner mutates, when `MUTATION_SHARD` is `k/n`.
 * Files are dealt largest first to the lightest shard, weighed in bytes —
 * close enough to a mutant count, and known to every runner from the checkout
 * alone, so each deals the same hand and the shards together are the scope.
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
  // Reported, not enforced here: `scripts/check-mutation-ratchet.mjs` owns
  // the pass and the fail.
  thresholds: { ...broadConfig.thresholds, break: null },
};
