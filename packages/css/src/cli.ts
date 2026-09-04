#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { checkProject } from "./check";
import { filesUnder, formatFile, formatText, lintFile, toolIn } from "./tooling";
import { ToolFailed, biomeFormatter, oxlintLinter } from "./tools";

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
 *
 * ## `format` and `lint`, for the tools that cannot read the file either
 *
 * ```
 * ramonda-css format <paths…>   # --check to report instead of writing
 * ramonda-css lint <paths…>
 * ```
 *
 * Neither is a reimplementation: the project's own biome and oxlint do the work, with their own
 * configuration, and this only decides what text they are shown. A suppression comment cannot do
 * the same job — it is read BY the parser, which has already failed.
 */

const TAG = "[ramonda-css]";
const argv = process.argv.slice(2);

/** Relative to where the command was run, which is how a person reads their own tree. */
const where = (file: string) => relative(process.cwd(), file) || file;

if (argv[0] === "format" || argv[0] === "lint") {
  runTool(argv[0], argv.slice(1));
}

const tsconfig = argv.find((argument) => !argument.startsWith("-")) ?? "tsconfig.json";

const report = checkProject(tsconfig);

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

/* ── format and lint ───────────────────────────────────────────────────────────────────────── */

/**
 * The formatter or the linter, over the paths given, with a style block handled where one is found.
 *
 * Every path is expanded here rather than handed to the tool, because the two halves need different
 * things from a file and only this knows which is which. A file with no block still goes through the
 * same call: one command over a whole tree beats two the caller has to keep in step.
 */
function runTool(which: "format" | "lint", args: readonly string[]): never {
  const check = args.includes("--check");
  const stdin = args.find((argument) => argument.startsWith("--stdin-file-path"));
  const paths = args.filter((argument) => !argument.startsWith("-"));
  const cwd = process.cwd();

  const name = which === "format" ? "biome" : "oxlint";
  const binary = toolIn(cwd, name);
  if (binary === undefined) {
    console.error(`\n${TAG} \`${name}\` is not installed here, so there is nothing to run.\n`);
    process.exit(1);
  }

  /**
   * One buffer in, the formatted text out, and nothing written — what an EDITOR needs.
   *
   * An editor asks a formatter about the buffer rather than the file: a provider that pointed this
   * at a path would format what was last saved and hand back edits computed against text the author
   * has since changed. The flag is spelled the way biome spells its own, because that is what the
   * caller is really reaching for and this is a wrapper over it.
   */
  if (stdin !== undefined) {
    if (which !== "format") {
      console.error(`\n${TAG} \`--stdin-file-path\` is for \`format\`; \`lint\` reports positions in a file.\n`);
      process.exit(1);
    }

    const named = stdin.includes("=") ? stdin.slice(stdin.indexOf("=") + 1) : (paths[0] ?? "stdin.tsx");
    const source = readFileSync(0, "utf8");
    try {
      process.stdout.write(formatText(source, resolve(cwd, named), biomeFormatter(binary, cwd)));
    } catch (error) {
      if (!(error instanceof ToolFailed)) throw error;
      console.error(`\n${TAG} \`${name}\` refused:\n\n${error.message}\n`);
      process.exit(1);
    }
    process.exit(0);
  }

  const files = filesUnder(paths.length === 0 ? ["."] : paths, cwd);

  if (which === "format") {
    const format = biomeFormatter(binary, cwd);
    const changed: string[] = [];
    try {
      for (const file of files) {
        if (formatFile(file, format, { write: !check }).changed) changed.push(file);
      }
    } catch (error) {
      // The tool's own words. A wrapper that answered with its call stack would have hidden the
      // only useful sentence — a config it cannot read, a version that is not there.
      if (!(error instanceof ToolFailed)) throw error;
      console.error(`\n${TAG} \`${name}\` refused:\n\n${error.message}\n`);
      process.exit(1);
    }

    if (changed.length === 0) {
      console.log(`${TAG} ${files.length} file(s) formatted`);
      process.exit(0);
    }
    if (!check) {
      console.log(`${TAG} ${files.length} file(s), ${changed.length} rewritten`);
      process.exit(0);
    }

    console.error(`\n${TAG} ${changed.length} file(s) are not formatted:\n`);
    for (const file of changed) console.error(`  ${where(file)}`);
    console.error("");
    process.exit(1);
  }

  const lint = oxlintLinter(binary, cwd);
  const found = files.flatMap((file) => lintFile(file, lint));

  if (found.length === 0) {
    console.log(`${TAG} ${files.length} file(s) lint clean`);
    process.exit(0);
  }

  console.error(`\n${TAG} ${found.length} lint problem(s) in ${files.length} file(s):\n`);
  for (const finding of found) {
    console.error(`  ${where(finding.file)}:${finding.line}:${finding.column}`);
    console.error(`    ${finding.code}: ${finding.message}`);
    console.error("");
  }
  process.exit(1);
}
