/**
 * Finds one judgement written more than once across `@ramonda/check`'s rules.
 *
 * ## Why this exists
 *
 * Two rules held the same answer to "which writes leave a cached reader stale", and the second copy was
 * wrong in four ways — it reported the constructor, the memo pattern and `@destroyed`, and it treated
 * `@persist` as reactive. Nothing failed; the copies simply disagreed. That is the failure mode a test
 * cannot catch, because each copy passes its own fixture.
 *
 * Run it after adding a rule. A hit is not automatically a defect — two rules may legitimately ask the
 * same small question — but it is the list worth looking at, and it takes a second.
 *
 *   node scripts/dev/find-duplicate-helpers.mjs
 *   node scripts/dev/find-duplicate-helpers.mjs 60     # a smaller size floor
 */
import { globSync, readFileSync } from "node:fs";

const floor = Number(process.argv[2] ?? 90);
const fns = [];

for (const file of globSync("packages/check/src/**/*.ts")) {
  if (file.includes("__tests__")) continue;
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(/^(?:export )?function (\w+)[\s\S]*?^}/gm)) {
    const body = match[0]
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "")
      .replace(/\s+/g, " ")
      .trim();
    fns.push({ name: match[1], file: file.split("/").pop(), body });
  }
}

/** Keyed by the body with the function's OWN name blanked, so two names for one answer still match. */
const byBody = new Map();
for (const fn of fns) {
  const key = fn.body.replaceAll(fn.name, "FN");
  if (!byBody.has(key)) byBody.set(key, []);
  byBody.get(key).push(fn);
}

let hits = 0;
for (const [key, group] of byBody) {
  const files = new Set(group.map((g) => g.file));
  if (files.size < 2 || key.length < floor) continue;
  hits++;
  console.log(`\n${group.map((g) => `${g.file}:${g.name}`).join("  ==  ")}`);
  console.log(`  ${key.slice(0, 160)}`);
}
console.log(`\n${fns.length} functions, ${hits} answer(s) written in more than one file (floor ${floor} chars)`);
