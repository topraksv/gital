import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { CI_EXECUTED_SCRIPTS, classify } from "../scripts/classify-changes.mjs";
import { evaluate } from "../scripts/check-lint-ratchet.mjs";
import { evaluate as evaluateMutation, scoreOf } from "../scripts/check-mutation-ratchet.mjs";
import { appVersionOf, entryOf, otaRecord, titleOf } from "../scripts/check-published.mjs";
import { notesFor } from "../scripts/release-notes.mjs";

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
    ["the browser suite moved", ["e2e/first-list.spec.ts"], true],
    ["a path nobody classified appeared", ["babel.config.js", "somewhere/new.ts"], true],
    ["a screen moved", ["src/app/index.tsx"], false],
    ["a token moved", ["src/ui/theme.ts"], false],
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

  it("escalates a mixed push by its riskiest path", () => {
    expect(classify(["docs/UI.md", "src/ui/theme.ts", "src/data/lists.ts"])).toMatchObject({
      full_gate: true,
      reason: "high risk: src/data/lists.ts",
    });
  });

  // A script that becomes part of the gate must not stay on the light tier by
  // being forgotten: follow every `run:` through `npm run` to `node scripts/`.
  it("knows every script ci.yml can reach", () => {
    const scripts: Record<string, string> = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts;
    const reached = new Set<string>();
    const walk = (command: string) => {
      for (const [, path] of command.matchAll(/node (scripts\/[\w.-]+\.mjs)/g)) reached.add(path!);
      for (const [, name] of command.matchAll(/npm (?:run )?([\w:-]+)/g)) {
        const target = name === "test" ? scripts.test : scripts[name!];
        if (target) walk(target);
      }
    };
    const workflow = readFileSync(join(root, ".github/workflows/ci.yml"), "utf8");
    for (const [, command] of workflow.matchAll(/run: (.+)/g)) walk(command!);

    expect(reached.size).toBeGreaterThan(0);
    expect([...reached].filter((path) => !CI_EXECUTED_SCRIPTS.includes(path))).toEqual([]);
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
    expect(evaluateMutation({ "a.ts": 91.4 }, { files: { "a.ts": 91.8 } }, present).problems).toEqual([]);
    expect(evaluateMutation({ "a.ts": 91.2 }, { files: { "a.ts": 91.8 } }, present).problems).toEqual(["WORSE a.ts: 91.80 -> 91.20."]);
  });

  it("refuses a file nobody measured and an entry whose file is gone", () => {
    const { problems } = evaluateMutation({ "new.ts": 99 }, { files: { "gone.ts": 80 } }, (file) => file !== "gone.ts");
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
