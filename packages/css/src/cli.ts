#!/usr/bin/env node
import { relative } from "node:path";
import { checkProject } from "./check";

/**
 * `ramonda-css [tsconfig.json]`
 *
 * Type-checks a project whose source TypeScript cannot parse — every `@( … )` block turned into a
 * virtual file, handed to `tsc`, and every diagnostic mapped back to the character the author typed.
 *
 * **A project using this syntax cannot run plain `tsc`**, which refuses the file at the parse step.
 * So this is that project's `tsc`: it reports ordinary type errors too, and a report that dropped
 * them would look like a passing check on a program nothing checked.
 *
 * Meant to sit in a `build` script beside the bundler. A check nobody runs is a check that does not
 * exist, and until this runs somewhere that fails, the type safety is a claim about editors.
 */

const TAG = "[ramonda-css]";
const argv = process.argv.slice(2);
const tsconfig = argv.find((argument) => !argument.startsWith("-")) ?? "tsconfig.json";

const report = checkProject(tsconfig);

/** Relative to where the command was run, which is how a person reads their own tree. */
const where = (file: string) => relative(process.cwd(), file) || file;

if (report.findings.length === 0) {
  console.log(`${TAG} ${report.files} file(s) type-check, ${report.styled} of them carrying a style block`);
  process.exit(0);
}

/**
 * A refusal is a syntax error and it is printed alone: nothing was type-checked, and saying "3
 * errors" when two of them are the parser's confusion about a file it could not read would be
 * three wrong answers instead of one right one.
 */
if (report.refused) {
  console.error(`\n${TAG} ${report.findings.length} block(s) could not be read, so nothing was checked:\n`);
  for (const finding of report.findings) {
    console.error(`  ${where(finding.file)}:${finding.line}:${finding.column}`);
    console.error(`    ${finding.message.replace(/^.*?:\d+:\d+\s+/, "")}`);
    console.error("");
  }
  process.exit(1);
}

console.error(`\n${TAG} ${report.findings.length} problem(s) in ${report.files} file(s):\n`);
for (const finding of report.findings) {
  console.error(`  ${where(finding.file)}:${finding.line}:${finding.column}`);
  // A number is TypeScript's; a name is one of our own CSS rules. Prefixing both the same way would
  // claim the compiler said something it did not.
  console.error(`    ${typeof finding.code === "number" ? `TS${finding.code}` : finding.code}: ${finding.message}`);
  console.error("");
}
console.error(
  `  ${report.styled} of those file(s) carry a style block. A position inside one is the author's own —\n` +
    `  the block is checked through a virtual file, and every diagnostic is mapped back to it.\n`,
);
process.exit(1);
