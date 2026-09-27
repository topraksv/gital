#!/usr/bin/env node
/**
 * Fail when a mutated file detects fewer mutants than it did last time.
 *
 * Helix's ratchet, and Helix's reason for it: an absolute threshold no real
 * change can meet is a step everyone routes around. What is worth enforcing
 * is that a file never gets worse, and that no file enters unmeasured: a
 * mutated file with no recorded score fails rather than being adopted at
 * whatever it happens to score.
 *
 * `--record` adopts the last run's scores, like the lint ratchet's. It is a
 * decision made after reading what survived, which is why nothing here adopts
 * on its own. Helix's separate writer is folded in here.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const REPORT = "reports/mutation/mutation.json";
const BASELINE = "mutation-baseline.json";

/**
 * How far a score may fall before it counts. Not slack: Stryker's timeout is
 * wall-clock and counts as detected, so how many mutants tip over it moves a
 * score with no code changed. Helix measured the drift under half a point.
 */
const TOLERANCE = 0.5;

/** Stryker's own definition: detected over everything that could be detected. */
export function scoreOf(mutants) {
  let detected = 0;
  let valid = 0;
  for (const { status } of mutants) {
    if (status === "Killed" || status === "Timeout") detected += 1;
    if (status === "Killed" || status === "Timeout" || status === "Survived" || status === "NoCoverage") valid += 1;
  }
  return valid === 0 ? 100 : Number(((detected / valid) * 100).toFixed(2));
}

export function scoresFromReport(report) {
  return Object.fromEntries(Object.entries(report.files ?? {}).map(([file, entry]) => [file, scoreOf(entry.mutants ?? [])]));
}

/**
 * @param {Record<string, number>} measured file -> score from this run
 * @param {{ files: Record<string, number> }} baseline
 * @param {(file: string) => boolean} exists injected so a stale entry is testable
 */
export function evaluate(measured, baseline, exists = existsSync) {
  const recorded = baseline.files ?? {};
  const problems = [];
  const improvements = [];
  for (const [file, score] of Object.entries(measured)) {
    const previous = recorded[file];
    if (previous === undefined) problems.push(`UNRECORDED ${file} scored ${score.toFixed(2)}: read what survived, then \`npm run mutation:record\`.`);
    else if (score < previous - TOLERANCE) problems.push(`WORSE ${file}: ${previous.toFixed(2)} -> ${score.toFixed(2)}.`);
    else if (score > previous + TOLERANCE) improvements.push(`${file}: ${previous.toFixed(2)} -> ${score.toFixed(2)}`);
  }
  for (const file of Object.keys(recorded)) {
    if (!exists(file)) problems.push(`STALE ${file} is recorded but gone: delete its entry.`);
  }
  return { problems, improvements };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!existsSync(REPORT)) {
    console.error(`No mutation report at ${REPORT}. Run \`npx stryker run\` first.`);
    process.exit(1);
  }
  const measured = scoresFromReport(JSON.parse(readFileSync(REPORT, "utf8")));

  if (process.argv.includes("--record")) {
    const sorted = Object.fromEntries(Object.entries(measured).sort(([a], [b]) => a.localeCompare(b)));
    writeFileSync(BASELINE, `${JSON.stringify({ files: sorted }, null, 2)}\n`);
    console.log(`Recorded ${Object.keys(sorted).length} file(s) into ${BASELINE}.`);
    process.exit(0);
  }

  const { problems, improvements } = evaluate(measured, JSON.parse(readFileSync(BASELINE, "utf8")));
  if (improvements.length > 0) {
    console.log(`Above the recorded score, record only if tests you added earned it:\n  ${improvements.join("\n  ")}`);
  }
  if (problems.length > 0) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  console.log(`No mutated file detects less than ${BASELINE} records.`);
}
