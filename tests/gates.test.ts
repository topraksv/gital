import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { CI_EXECUTED_SCRIPTS, classify } from "../scripts/classify-changes.mjs";
import { evaluate } from "../scripts/check-lint-ratchet.mjs";
import { evaluate as evaluateMutation, recordedFrom, scoreOf } from "../scripts/check-mutation-ratchet.mjs";
import { appVersionOf, entryOf, greenRun, openRuns, otaRecord, titleOf } from "../scripts/check-published.mjs";
import { notesFor } from "../scripts/release-notes.mjs";
import { isMutationScoped, selectMutationScope, shardOfScope } from "../stryker.ci.config.mjs";

const root = join(import.meta.dirname, "..");

describe("classify-changes", () => {
  it.each([
    ["no diff could be taken", null, true],
    ["a record's meaning moved", ["src/domain/list.ts"], true],
    ["the database moved", ["supabase/migrations/0001_init.sql"], true],
    ["the local database moved", ["src/db/migrations/0001_items.sql"], true],
    ["the dependency tree moved", ["package-lock.json"], true],
    ["the root layout moved", ["src/app/_layout.tsx"], true],
    ["a script the gate runs moved", ["scripts/check-web-budget.mjs"], true],
    ["a path nobody classified appeared", ["babel.config.js", "somewhere/new.ts"], true],
    ["a test behind a floor moved", ["tests/domain/lists.test.ts"], true],
    ["the tests' shared harness moved", ["tests/helpers.ts"], true],
    ["a test of the delivery itself moved", ["tests/gates.test.ts"], false],
    ["a screen moved", ["src/app/index.tsx"], false],
    ["a token moved", ["src/ui/theme.ts"], false],
    ["the browser suite moved", ["e2e/first-list.spec.ts"], false],
    ["only prose moved", ["docs/BACKLOG.md", "AGENTS.md", ".claude/hooks/stop-gate.sh"], false],
    ["nothing moved", [], false],
  ])("full gate when %s", (_, files, full) => {
    expect(classify(files).full_gate).toBe(full);
  });

  it.each([
    ["no diff could be taken", null, true],
    ["a screen moved", ["src/app/index.tsx"], true],
    ["a picture moved", ["public/products/tomato.webp"], true],
    ["the dependency tree moved", ["package-lock.json"], true],
    ["the deploy itself moved", [".github/workflows/ci.yml"], true],
    ["only a test moved", ["tests/gates.test.ts"], false],
    ["only the database moved", ["supabase/migrations/0002_lists.sql"], false],
    ["another workflow moved", [".github/workflows/security.yml"], false],
    ["only prose moved", ["docs/RELEASE.md"], false],
  ])("publishes the web when %s", (_, files, publishes) => {
    expect(classify(files).deploy_web).toBe(publishes);
  });

  it.each([
    ["no diff could be taken", null, true],
    ["a screen moved", ["src/app/index.tsx"], true],
    ["a picture the app bundles moved", ["assets/icon.png"], true],
    ["the dependency tree moved", ["package-lock.json"], true],
    ["the deploy itself moved", [".github/workflows/ci.yml"], true],
    ["only the web's own files moved", ["public/products/tomato.webp", "scripts/check-web-budget.mjs"], false],
    ["only a test moved", ["tests/gates.test.ts"], false],
    ["only prose moved", ["docs/RELEASE.md"], false],
  ])("publishes to Expo Go when %s", (_, files, publishes) => {
    expect(classify(files).deploy_mobile).toBe(publishes);
  });

  // The whole suite, on every push that can change what it renders or how it
  // is tested, on either tier.
  it.each([
    ["no diff could be taken", null, true],
    ["a screen moved", ["src/app/index.tsx"], true],
    ["the browser suite moved", ["e2e/first-list.spec.ts"], true],
    ["the server it drives moved", ["scripts/serve-web-export.mjs"], true],
    ["only a unit test moved", ["tests/gates.test.ts"], false],
    ["only the database moved", ["supabase/migrations/0002_lists.sql"], false],
  ])("runs the browser suite when %s", (_, files, runs) => {
    expect(classify(files).run_e2e).toBe(runs);
  });

  it("escalates a mixed push by its riskiest path", () => {
    expect(classify(["docs/UI.md", "src/ui/theme.ts", "src/data/lists.ts"])).toMatchObject({
      full_gate: true,
      reason: "high risk: src/data/lists.ts",
    });
  });

  /**
   * Every script ci.yml can reach, followed rather than listed: its `run:`
   * lines, the `npm run` targets they name, the hooks `npm ci` runs, and the
   * configs those commands load — `playwright.config.ts` starts the web server
   * and `stryker.config.mjs` loads the runner, and neither is a `run:`.
   * A script named in a comment is not run, so only `node scripts/…` and a
   * quoted `./scripts/…` count.
   */
  it("escalates exactly the scripts ci.yml can reach, and no more", () => {
    const scripts: Record<string, string> = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts;
    const configFor: Record<string, string[]> = {
      "playwright test": ["playwright.config.ts"],
      "stryker run": ["stryker.config.mjs", "stryker.ci.config.mjs"],
    };
    const reached = new Set<string>();
    const visited = new Set<string>();
    const walk = (text: string) => {
      for (const [, path] of text.matchAll(/(?:node |"\.\/)(scripts\/[\w.-]+\.mjs)/g)) reached.add(path!);
      for (const [command, configs] of Object.entries(configFor)) {
        if (!text.includes(command)) continue;
        for (const config of configs) {
          if (visited.has(config)) continue;
          visited.add(config);
          walk(readFileSync(join(root, config), "utf8"));
        }
      }
      for (const [, name, noHooks] of text.matchAll(/npm (?:run )?([\w:-]+)( --ignore-scripts)?/g)) {
        const targets = name === "ci" ? (noHooks ? [] : ["preinstall", "install", "postinstall", "prepare"]) : [name!];
        for (const target of targets) {
          if (visited.has(target) || scripts[target] == null) continue;
          visited.add(target);
          walk(scripts[target]!);
        }
      }
    };
    walk(readFileSync(join(root, ".github/workflows/ci.yml"), "utf8"));

    expect(reached.size).toBeGreaterThan(3);
    expect([...CI_EXECUTED_SCRIPTS].sort()).toEqual([...reached].sort());
  });

  // `check-published.mjs green` owns the one query, unfiltered and paged: its
  // note says which run search answered weeks stale, and what that cost.
  it("asks for the newest green run through one paged query", () => {
    for (const name of ["ci.yml", "nightly.yml", "release.yml"]) {
      const text = readFileSync(join(root, ".github/workflows", name), "utf8");
      expect(text, name).not.toContain("/runs?");
      expect(text, name).toContain("node scripts/check-published.mjs green");
    }
  });
});

describe("mutation scope", () => {
  it("mutates the in-scope files the range changed", () => {
    const repository = mkdtempSync(join(tmpdir(), "gital-mutation-scope-"));
    const git = (...args: string[]) => execFileSync("git", args, { cwd: repository, encoding: "utf8" }).trim();
    try {
      git("init", "--quiet");
      git("config", "user.email", "mutation@example.invalid");
      git("config", "user.name", "Mutation Test");
      // A signing key in the global config would ask for its passphrase here.
      git("config", "commit.gpgsign", "false");
      mkdirSync(join(repository, "src/domain"), { recursive: true });
      writeFileSync(join(repository, "src/domain/list.ts"), "export const size = 1;\n");
      git("add", ".");
      git("commit", "--quiet", "-m", "base");
      const base = git("rev-parse", "HEAD");
      writeFileSync(join(repository, "src/domain/list.ts"), "export const size = 2;\n");
      writeFileSync(join(repository, "README.md"), "prose\n");
      git("add", ".");
      git("commit", "--quiet", "-m", "change");
      expect(selectMutationScope({ base, head: git("rev-parse", "HEAD"), cwd: repository })).toEqual(["src/domain/list.ts"]);

      // A file's tests or its recorded floor decide its score as much as its source.
      writeFileSync(join(repository, "src/domain/item.ts"), "export const kind = 1;\n");
      writeFileSync(join(repository, "mutation-baseline.json"), JSON.stringify({ files: { "src/domain/item.ts": { score: 80 }, "src/domain/list.ts": { score: 90 } } }));
      git("add", ".");
      git("commit", "--quiet", "-m", "floors");
      const floors = git("rev-parse", "HEAD");
      mkdirSync(join(repository, "tests/domain"), { recursive: true });
      // Named for what it checks, not for the file it imports.
      writeFileSync(join(repository, "tests/domain/size-bounds.test.ts"), 'import { size } from "../../src/domain/list";\n// fewer cases\n');
      writeFileSync(join(repository, "mutation-baseline.json"), JSON.stringify({ files: { "src/domain/item.ts": { score: 85 }, "src/domain/list.ts": { score: 90, measuredOn: "later" } } }));
      git("add", ".");
      git("commit", "--quiet", "-m", "raise");
      // list.ts comes in through its test; its floor only moved provenance.
      expect(selectMutationScope({ base: floors, head: git("rev-parse", "HEAD"), cwd: repository })).toEqual([
        "src/domain/item.ts",
        "src/domain/list.ts",
      ]);
    } finally {
      rmSync(repository, { recursive: true, force: true });
    }
  }, 30_000);

  // A push must name a range it can resolve; only a dispatch falls back to
  // the sentinels without one.
  it("fails closed on a push it cannot measure", () => {
    expect(() => selectMutationScope({ base: "0".repeat(40), head: "HEAD", cwd: root })).toThrow(/zero SHA/);
    expect(() => selectMutationScope({ base: "", head: "HEAD", eventName: "push", cwd: root })).toThrow(/missing mutation diff/i);
    expect(selectMutationScope({ base: "", head: "", eventName: "workflow_dispatch", cwd: root })).toContain("src/domain/names.ts");
  });

  // Helix's directories since 2026-10-08, less what carries no logic.
  it("mutates storage, sync, sign-in and services, never what has nothing to mutate", () => {
    for (const file of ["src/domain/items.ts", "src/data/items.ts", "src/db/mutations.ts", "src/sync/engine.ts", "src/auth/session.ts", "src/services/reminders.native.ts"]) {
      expect(isMutationScoped(file), file).toBe(true);
    }
    for (const file of ["src/db/schema.ts", "src/db/migrations/migrations.js", "src/db/expo-sqlite.server.js", "src/sync/realtime-absent.js", "src/data/hooks.ts", "src/ui/theme.ts", "src/app/index.tsx"]) {
      expect(isMutationScoped(file), file).toBe(false);
    }
  });

  it("deals every file to exactly one shard, heaviest first", () => {
    const sizes: Record<string, number> = { "a.ts": 900, "b.ts": 500, "c.ts": 400, "d.ts": 300, "e.ts": 100 };
    const files = Object.keys(sizes);
    const shards = [1, 2, 3].map((shard) => shardOfScope(files, `${shard}/3`, (file: string) => sizes[file]!));
    expect(shards).toEqual([["a.ts"], ["b.ts", "e.ts"], ["c.ts", "d.ts"]]);
    expect(() => shardOfScope(files, "4/3", () => 1)).toThrow(/MUTATION_SHARD/);
  });
});

describe("lint ratchet", () => {
  it("fails a rule that fires more often than recorded", () => {
    expect(evaluate({ complexity: 3 }, { rules: { complexity: 2 } }).problems).toEqual(["WORSE complexity: 2 -> 3."]);
  });

  it("fails a rule with no recorded baseline at all", () => {
    expect(evaluate({ "no-unused-vars": 1 }, { rules: {} }).problems).toHaveLength(1);
  });

  it("reports a drop, including to zero, without failing", () => {
    const { problems, improvements } = evaluate({ complexity: 1 }, { rules: { complexity: 2, eqeqeq: 4 } });
    expect(problems).toEqual([]);
    expect(improvements).toEqual(["complexity: 2 -> 1", "eqeqeq: 4 -> 0"]);
  });
});

describe("mutation ratchet", () => {
  const present = () => true;

  it("counts a timeout as detected and an uncovered mutant against the total", () => {
    expect(scoreOf([{ status: "Killed" }, { status: "Timeout" }, { status: "Survived" }, { status: "NoCoverage" }])).toBe(50);
    expect(scoreOf([{ status: "CompileError" }])).toBe(100);
  });

  it("holds a file to its recorded score, half a point of runner drift aside", () => {
    expect(evaluateMutation({ "a.ts": 91.4 }, { files: { "a.ts": { score: 91.8 } } }, present).problems).toEqual([]);
    expect(evaluateMutation({ "a.ts": 91.2 }, { files: { "a.ts": { score: 91.8 } } }, present).problems[0]).toMatch(/^WORSE a\.ts: 91\.80 -> 91\.20\./);
  });

  it("records the counts behind each score and the tree it was measured on", () => {
    const mutants = ["Killed", "Timeout", "Survived", "NoCoverage", "CompileError"].map((status) => ({ status }));
    expect(recordedFrom({ files: { "a.ts": { mutants } } }, "abc", "2026-10-08")).toEqual({
      "a.ts": { score: 50, killed: 1, timeout: 1, survived: 1, noCoverage: 1, measuredOn: "abc", measuredDate: "2026-10-08" },
    });
  });

  // A push that touches nothing in scope mutates the sentinels; an unrecorded
  // one fails that push for a reason it did not cause.
  it("has a recorded floor for every sentinel, with the counts that derive it", () => {
    const recorded = JSON.parse(readFileSync(join(root, "mutation-baseline.json"), "utf8")).files;
    const sentinels = selectMutationScope({ base: "", head: "", eventName: "workflow_dispatch", cwd: root });
    expect(sentinels.filter((file: string) => recorded[file] === undefined)).toEqual([]);
    for (const [file, entry] of Object.entries(recorded) as [string, Record<string, number>][]) {
      const detected = entry.killed! + entry.timeout!;
      const valid = detected + entry.survived! + entry.noCoverage!;
      expect(valid === 0 ? 100 : Number(((detected / valid) * 100).toFixed(2)), file).toBe(entry.score);
      expect(entry.measuredOn, file).toMatch(/^[0-9a-f]{40}$/);
    }
  });

  it("refuses a file nobody measured and an entry whose file is gone", () => {
    const { problems } = evaluateMutation({ "new.ts": 99 }, { files: { "gone.ts": { score: 80 } } }, (file) => file !== "gone.ts");
    expect(problems.map((problem) => problem.split(" ")[0])).toEqual(["UNRECORDED", "STALE"]);
  });

  // Vitest 5 matches a name filter against "suite > test", which Stryker 10
  // does not send, so a mutant's covering tests are run by file instead.
  it("runs a mutant's covering tests by their files, not by a name Vitest 5 would not match", async () => {
    const { strykerPlugins } = await import("../scripts/stryker-vitest-files.mjs");
    const calls: unknown[] = [];
    const upstream = { run: (options: unknown) => calls.push(options) };
    const injector = { provideValue: () => ({ injectClass: () => upstream }) };
    // `run` is the upstream runner's own method, not part of Stryker's `TestRunner` contract.
    const runner = strykerPlugins[0]!.factory(injector) as unknown as { run: (options: object) => void };
    runner.run({ testIds: ["tests/a.test.ts#suite one", "tests/a.test.ts#suite two", "tests/b.test.ts#other"], relatedFiles: ["x"] });
    runner.run({ relatedFiles: ["x"] });
    expect(calls).toEqual([{ relatedFiles: ["x"], testFiles: ["tests/a.test.ts", "tests/b.test.ts"] }, { relatedFiles: ["x"] }]);
  });
});

describe("check-published", () => {
  // GitHub's run search answered weeks stale, so every filter is here.
  it("finds the newest green push run on main, or a commit's, and the head's open runs", () => {
    const run = (head_sha: string, extra: Record<string, string> = {}) => ({
      head_sha, event: "push", head_branch: "main", conclusion: "success", status: "completed", html_url: `u/${head_sha}`, ...extra,
    });
    const runs = [
      run("h", { status: "in_progress", conclusion: "" }),
      run("d", { event: "workflow_dispatch" }),
      run("f", { conclusion: "failure" }),
      run("o", { head_branch: "other" }),
      run("g"),
      run("e"),
    ];
    expect(greenRun(runs)?.head_sha).toBe("g");
    expect(greenRun(runs, "e")?.html_url).toBe("u/e");
    expect(greenRun(runs, "d")).toBeNull();
    expect(openRuns(runs, "h")).toBe(1);
    expect(openRuns(runs, "g")).toBe(0);
  });

  it("reads the entry bundle a shell under the site's base references", () => {
    const html = '<script src="/gital/_expo/static/js/web/entry-4daa5bb8e8ad49f6911813b0513df45f.js" defer></script>';
    expect(entryOf(html)).toBe("/_expo/static/js/web/entry-4daa5bb8e8ad49f6911813b0513df45f.js");
    expect(entryOf("<html></html>")).toBeNull();
  });

  // The browser shows the first <title>; Expo Router's head writes an empty
  // one before the shell's unless a screen gives it one (2026-09-26).
  it("reads the title a browser shows, the first in the document", () => {
    expect(titleOf('<title data-rh="true">Gital · Ne eksik?</title><title>Gital</title>')).toBe("Gital · Ne eksik?");
    expect(titleOf('<title data-rh="true"></title><title>Gital</title>')).toBe("");
    expect(titleOf("<html></html>")).toBeNull();
  });

  // Expo embeds the app config as an escaped JSON string, beside libraries
  // that declare versions of their own.
  // One `eas update --platform all`: both platforms, one group, and the
  // runtime Expo Go loads for this SDK, or the phone never sees it.
  it("accepts one update per platform in one group on Expo Go's runtime, and records it", () => {
    const update = (platform: string, runtimeVersion = "exposdk:57.0.0", group = "g1") => ({
      platform, runtimeVersion, group, id: `${platform}-id`, message: "1.0.0 abc", manifestPermalink: `https://u.expo.dev/${platform}`,
    });
    const { problems, summary } = otaRecord([update("ios"), update("android")], 57);
    expect(problems).toEqual([]);
    expect(summary.join("\n")).toContain("`g1`");
    expect(summary.join("\n")).toContain("| android | `android-id` |");
    expect(otaRecord([update("ios")], 57).problems).toEqual(["expected one update per platform, got [ios]"]);
    expect(otaRecord([update("ios"), update("android", "exposdk:57.0.0", "g2")], 57).problems).toEqual(["expected one update group, got 2"]);
    expect(otaRecord([update("ios", "1.0.0"), update("android")], 57).problems).toEqual(["the ios update targets 1.0.0, not exposdk:57.0.0"]);
    expect(otaRecord(null, 57).problems).toHaveLength(2);
  });

  // `eas.json` names the CLI the project needs; the publish runs another only
  // by someone moving one and forgetting the other.
  it("publishes with the EAS CLI eas.json names", () => {
    const wanted = JSON.parse(readFileSync(join(root, "eas.json"), "utf8")).cli.version;
    const used = [...readFileSync(join(root, ".github/workflows/ci.yml"), "utf8").matchAll(/eas-cli@([\d.]+)/g)].map(([, version]) => version);
    expect(used.length).toBeGreaterThan(1);
    expect(new Set(used)).toEqual(new Set([wanted]));
  });

  // `sdkVersion` is right for Expo Go only: it does not move when the native
  // project does, so an update sent to a store binary could land on one that
  // cannot run it. With no `updates.url` and no channel, expo-updates is off in
  // a store build and it runs the bundle it shipped with (Expo SDK 57 docs), so
  // the two share a repository safely. Giving a store build updates means
  // `fingerprint` first, and this test fails until then.
  it("builds a TestFlight binary that no Expo Go update can reach", () => {
    const eas = JSON.parse(readFileSync(join(root, "eas.json"), "utf8"));
    const app = JSON.parse(readFileSync(join(root, "app.json"), "utf8")).expo;
    expect(eas.build.production).toMatchObject({ autoIncrement: true });
    expect(eas.cli.appVersionSource).toBe("remote");
    expect(Object.values(eas.build).filter((profile) => "channel" in (profile as object))).toEqual([]);
    expect(app.updates).toBeUndefined();
    expect(app.runtimeVersion).toEqual({ policy: "sdkVersion" });
    expect(app.ios.config.usesNonExemptEncryption).toBe(false);
  });

  it("reads the version of the object that carries the app's slug", () => {
    const bundle = String.raw`x={\"name\":\"lib\",\"version\":\"9.9.9\"};y="{\"name\":\"Gital\",\"slug\":\"gital\",\"version\":\"1.2.0\"}"`;
    expect(appVersionOf(bundle, "gital")).toBe("1.2.0");
    expect(appVersionOf("{}", "gital")).toBeNull();
    expect(() => appVersionOf(bundle, "gi.tal")).toThrow();
  });
});

/**
 * Helix's version discipline: `app.json` is the version of record, the
 * changelog's newest section names it, and `release.yml` publishes a tag only
 * from that section. Bumping the version and stopping there fails here.
 */
describe("version and changelog", () => {
  const read = (path: string) => readFileSync(join(root, path), "utf8");
  const app = JSON.parse(read("app.json"));
  const packageJson = JSON.parse(read("package.json"));
  const changelog = read("CHANGELOG.md");
  const versions = [...changelog.matchAll(/^## (\d+\.\d+\.\d+)\s*$/gm)].map((match) => match[1]!);
  const order = (version: string) => version.split(".").map(Number);

  it("ships one version string, in app.json and package.json alike", () => {
    expect(app.expo.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(packageJson.version).toBe(app.expo.version);
  });

  it("names the shipped version at the top of the changelog, newest first, none twice", () => {
    expect(versions[0]).toBe(app.expo.version);
    expect(new Set(versions).size).toBe(versions.length);
    for (let at = 1; at < versions.length; at += 1) {
      const [newer, older] = [order(versions[at - 1]!), order(versions[at]!)];
      expect([0, 1, 2].map((part) => Math.sign(newer[part]! - older[part]!)).find((rank) => rank !== 0), `${versions[at - 1]} above ${versions[at]}`).toBe(1);
    }
  });

  it("gives every release a note of its own", () => {
    for (const version of versions) expect(notesFor(changelog, version), version).toMatch(/^### .+\n\n- .{10,}/);
  });

  it("finds a section by its exact heading, never by a prefix", () => {
    const text = "## 1.4.10\n\n- ten\n\n## 1.4.1\n\n- one\n";
    expect(notesFor(text, "1.4.1")).toBe("- one");
    expect(notesFor(text, "1.4.10")).toBe("- ten");
    expect(notesFor(text, "1.4")).toBeNull();
    expect(notesFor("## 2.0.0\n\n", "2.0.0")).toBeNull();
  });
});

const budgetRoots: string[] = [];
const budgetScript = join(root, "scripts/check-web-budget.mjs");

function fixture(bundle = "console.log('ok');") {
  const root = mkdtempSync(join(tmpdir(), "gital-web-budget-"));
  budgetRoots.push(root);
  const js = join(root, "_expo", "static", "js", "web");
  mkdirSync(js, { recursive: true });
  writeFileSync(join(js, "entry-test.js"), bundle);
  return { root, js };
}

function check(root: string, args: string[] = [], options: { env?: Record<string, string>; cwd?: string } = {}) {
  return spawnSync(process.execPath, [budgetScript, root, ...args], {
    encoding: "utf8",
    cwd: options.cwd,
    env: options.env ? { ...process.env, ...options.env } : process.env,
  });
}

afterEach(() => {
  for (const root of budgetRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("web release budget", () => {
  it("accepts a bounded export without public debugging data", () => {
    const { root } = fixture();
    const result = check(root);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("sourceMapFiles: 0");
    expect(result.stdout).toContain("sourceMapReferences: 0");
  });

  // Pictures are content, not code: a catalogue of product photos grows on
  // its own clock, so it carries a ceiling of its own instead of eating the
  // export's.
  it("weighs pictures apart from the rest of the export", () => {
    const { root } = fixture();
    writeFileSync(join(root, "photo.webp"), "x".repeat(1000));
    const result = check(root);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("pictureBytes: 1000 bytes");
    expect(result.stdout).toContain("totalExport: 18 bytes");
  });

  it("rejects source-map files and bundle references", () => {
    const { root, js } = fixture("console.log('mapped');\n//# sourceMappingURL=entry-test.js.map");
    writeFileSync(join(js, "entry-test.js.map"), "{}");
    const result = check(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Public source maps found");
    expect(result.stderr).toContain("Public source-map references found");
  });

  // Metro's transform cache is shared by `expo export` and `eas update` and its
  // key ignores EXPO_PUBLIC_* values, so a cache left by the local-only E2E
  // export yields a bundle with no Supabase configuration — sign-in and sync
  // silently gone, invisible to every other budget metric.
  it("rejects a production export that lost its Supabase configuration", () => {
    const { root } = fixture("console.log('no config here');");
    const result = check(root, ["--require-supabase-config"], {
      env: { EXPO_PUBLIC_SUPABASE_URL: "https://example.supabase.co" },
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("supabaseConfigInlined: false");
    expect(result.stderr).toContain("Re-export with --clear");
  });

  it("accepts a production export that carries it, and says so when there is none to carry", () => {
    const configured = fixture("var u='https://example.supabase.co';");
    expect(check(configured.root, ["--require-supabase-config"], {
      env: { EXPO_PUBLIC_SUPABASE_URL: "https://example.supabase.co" },
    }).status).toBe(0);

    // A local-only build is legitimate; the skip is printed, never assumed. Run
    // from the fixture directory so the repository's own `.env` cannot answer
    // for an environment that genuinely has none.
    const local = fixture();
    const result = check(local.root, ["--require-supabase-config"], {
      cwd: local.root,
      env: { EXPO_PUBLIC_SUPABASE_URL: "" },
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("supabaseConfigInlined: skipped");
  });

  // What push protection cannot see: a value that reaches the bundle from a
  // build environment rather than from a commit. The credentials are assembled
  // at runtime so this file does not itself carry the shapes it tests for.
  it("rejects a server credential anywhere in the export, naming the file and never the value", () => {
    const secret = ["sb", "secret", "x".repeat(24)].join("_");
    const { root } = fixture(`var key="${secret}";`);
    const result = check(root);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("serverCredentialReferences: 1");
    expect(result.stderr).toContain(`Supabase secret key in ${join("_expo", "static", "js", "web", "entry-test.js")}`);
    expect(result.stdout + result.stderr).not.toContain(secret);
  });

  it("tells a service-role JWT from the anon one that ships by design", () => {
    const token = (role: string) => [
      Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
      Buffer.from(JSON.stringify({ iss: "supabase", role })).toString("base64url"),
      Buffer.from("not-a-real-signature").toString("base64url"),
    ].join(".");
    expect(check(fixture(`var anon="${token("anon")}";`).root).status).toBe(0);
    const leaked = check(fixture(`var admin="${token("service_role")}";`).root);
    expect(leaked.status).toBe(1);
    expect(leaked.stderr).toContain("service-role JWT in");
  });
});
