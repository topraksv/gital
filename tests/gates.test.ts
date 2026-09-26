import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { CI_EXECUTED_SCRIPTS, classify } from "../scripts/classify-changes.mjs";
import { evaluate } from "../scripts/check-lint-ratchet.mjs";
import { appVersionOf, entryOf, titleOf } from "../scripts/check-published.mjs";

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
  it("reads the version of the object that carries the app's slug", () => {
    const bundle = String.raw`x={\"name\":\"lib\",\"version\":\"9.9.9\"};y="{\"name\":\"Gital\",\"slug\":\"gital\",\"version\":\"1.2.0\"}"`;
    expect(appVersionOf(bundle, "gital")).toBe("1.2.0");
    expect(appVersionOf("{}", "gital")).toBeNull();
    expect(() => appVersionOf(bundle, "gi.tal")).toThrow();
  });
});
