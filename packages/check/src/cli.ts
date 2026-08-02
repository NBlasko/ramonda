#!/usr/bin/env node
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { analyzeProject } from "./analyze";

/**
 * `ramonda-check-context [tsconfig]`
 *
 * Exits non-zero when a context consumer has no provider above it on some path the source can be
 * read to produce. Meant to sit in an app's `build` script: a check nobody runs is a check that
 * does not exist, and this is the class of fault that otherwise reaches a user — the page renders,
 * the context quietly falls back to its default, and the numbers are wrong.
 */
const arg = process.argv[2];
const tsconfig = resolve(arg ?? "tsconfig.json");

if (!existsSync(tsconfig)) {
  console.error(`[ramonda-check-context] no tsconfig at ${tsconfig}. Pass one: ramonda-check-context <path>`);
  process.exit(2);
}

const { issues, counts, notes } = analyzeProject(tsconfig);

for (const note of notes) console.warn(`[ramonda-check-context] ${note}`);

if (issues.length === 0) {
  console.log(
    `[ramonda-check-context] ${counts.components} components, ${counts.contexts} contexts, ` +
      `${counts.roots} root(s) — every consumer has a provider above it.`,
  );
  process.exit(0);
}

console.error(`\n[ramonda-check-context] ${issues.length} consumer(s) with no provider above them:\n`);
for (const issue of issues) {
  console.error(`  ${issue.file}:${issue.line}:${issue.column}`);
  console.error(`    <${issue.consumer}> consumes "${issue.context}" — nothing provides it on this path:`);
  console.error(`    ${issue.path.join(" → ")}`);
  console.error("");
}
console.error(
  `Mount the matching Provider on a component above it — a context reaches only the providing\n` +
    `component and its descendants. This ran before the app did, so nothing had to render for it\n` +
    `to be found.\n`,
);
process.exit(1);
