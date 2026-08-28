#!/usr/bin/env node
/**
 * Every finding this package produces across EVERY fixture, recorded or compared.
 *
 * Written because reviewing a branch of rule changes has one question that a diff cannot answer and
 * a test suite answers only where somebody thought to assert it: **what stopped being reported?**
 * A new finding is visible — a test fails, or the CLI output grows. A lost one is invisible by
 * definition, and a rule that reports nothing looks exactly like a clean codebase.
 *
 * It costs nothing to run. No network, no model, no judgement: it runs the analyzer over all ~80
 * fixtures and prints the set difference.
 *
 *   node scripts/findings-across-fixtures.mjs --write baseline.txt      # on `main`
 *   node scripts/findings-across-fixtures.mjs --against baseline.txt    # on the branch
 *
 * The second form exits non-zero when anything was LOST, and lists it. Gains are printed too, but
 * they do not fail: adding a report is the work, and every one of them should have a test beside it.
 *
 * `dist/` has to be built first — this reads what the package actually ships.
 *
 * ## What is normalised away, and why each one
 *
 * A line reference moves whenever a fixture is edited, which is most of what a rule change touches.
 * Comparing them would bury the signal in noise from plants that were deliberately added. So
 * `line`, `column` and every `…AtLine` are dropped, along with `foundIn`, which names a place and
 * moves for the same reason. What is left is WHAT was reported about WHICH subject, which is the
 * claim a rule makes.
 */
import { readdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "..", "src", "__tests__", "fixtures");
const dist = join(here, "..", "dist", "index.js");

/** Fields that move when a fixture is edited rather than when a rule changes. */
const MOVES_WITH_THE_FILE = new Set([
  "line",
  "column",
  "foundIn",
  "replacedAtLine",
  "firstAtLine",
  "providerAtLine",
  "afterAtLine",
  // `edit` carries character offsets, which move whenever a fixture gains a line above them — the
  // same reason `line` is here. It caught itself the day it was added: every finding of the first
  // rule to carry an edit read as LOST, because the claim had gained a field while the rule was
  // reporting exactly as before.
  //
  // The whole field is dropped, not just its offsets, so what an edit REPLACES is not compared
  // here. That is a real gap and a deliberate one: nesting the normaliser to reach inside would
  // cost more than it buys, and each rule that carries an edit asserts its `text` in its own test,
  // where a wrong replacement is a failure rather than a line in a diff.
  "edit",
]);

if (!existsSync(dist)) {
  console.error("[findings] no dist/ — run `pnpm build` first; this reads what the package ships.");
  process.exit(2);
}

const { analyzeProject } = await import(dist);

/** One line per finding: the fixture, the rule, and the claim with the moving parts removed. */
function collect() {
  const lines = [];

  for (const name of readdirSync(fixtures).sort()) {
    const config = join(fixtures, name, "tsconfig.json");
    if (!existsSync(config)) continue;

    let findings;
    try {
      ({ findings } = analyzeProject(config));
    } catch (error) {
      // A fixture that THROWS is itself a finding, and one worth failing on rather than skipping.
      lines.push(`${name} :: THREW :: ${String(error?.message ?? error).slice(0, 120)}`);
      continue;
    }

    for (const [rule, issues] of Object.entries(findings)) {
      for (const issue of issues) {
        const claim = Object.fromEntries(
          Object.entries(issue)
            .filter(([key]) => key !== "file" && !MOVES_WITH_THE_FILE.has(key))
            .sort(([a], [b]) => a.localeCompare(b)),
        );
        lines.push(`${name} :: ${rule} :: ${JSON.stringify(claim)}`);
      }
    }
  }

  return lines.sort();
}

const [mode, target] = process.argv.slice(2);
const now = collect();

if (mode === "--write") {
  if (target === undefined) {
    console.error("[findings] --write needs a file to write to.");
    process.exit(2);
  }
  writeFileSync(target, `${now.join("\n")}\n`);
  console.log(`[findings] ${now.length} findings across the fixtures → ${target}`);
  process.exit(0);
}

if (mode !== "--against" || target === undefined) {
  console.error("[findings] usage: --write <file> | --against <file>");
  process.exit(2);
}

/** Counted rather than set-compared: two identical claims in one fixture are two findings. */
function tally(lines) {
  const counts = new Map();
  for (const line of lines) counts.set(line, (counts.get(line) ?? 0) + 1);
  return counts;
}

const before = tally(readFileSync(target, "utf8").split("\n").filter(Boolean));
const after = tally(now);

const lost = [];
const gained = [];
for (const [line, count] of before) {
  const missing = count - (after.get(line) ?? 0);
  for (let i = 0; i < missing; i++) lost.push(line);
}
for (const [line, count] of after) {
  const extra = count - (before.get(line) ?? 0);
  for (let i = 0; i < extra; i++) gained.push(line);
}

if (gained.length > 0) {
  console.log(`[findings] ${gained.length} added — each of these wants a test beside it:`);
  for (const line of gained.sort()) console.log(`  + ${line}`);
}

if (lost.length === 0) {
  console.log(`[findings] nothing lost across ${before.size} distinct claims. That is the direction that matters.`);
  process.exit(0);
}

console.log(`\n[findings] ${lost.length} LOST — a rule stopped saying something, and nothing else would show it:`);
for (const line of lost.sort()) console.log(`  - ${line}`);
console.log("\nEvery one has to be a loss you can name. Silence is what a clean codebase looks like.");
process.exit(1);
