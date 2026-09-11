#!/usr/bin/env node
import { existsSync, readFileSync, statSync, writeSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { checkProject } from "./check";
import { ConfigError } from "./config";
import { filesUnder, formatFile, formatText, lintFile, toolIn } from "./tooling";
import { ToolFailed, biomeFormatter, oxlintLinter } from "./tools";

/**
 * `ramonda-css [tsconfig.json]`
 *
 * Type-checks a project whose source TypeScript cannot parse — every `@@( … )` block turned into a
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

const USAGE = `ramonda-css — the tools for a project whose source TypeScript cannot parse

  ramonda-css [tsconfig.json]      type-check the project, mapping every diagnostic home
  ramonda-css format <paths…>      format through the project's own biome (--check to report)
  ramonda-css lint <paths…>        lint through the project's own oxlint

The check takes a PROJECT — a tsconfig, or the directory holding one — because a program is what
is type-checked. \`format\` and \`lint\` take paths, because a file is what they rewrite and read.`;
const argv = process.argv.slice(2);

/** Relative to where the command was run, which is how a person reads their own tree. */
const where = (file: string) => relative(process.cwd(), file) || file;

/**
 * Help first, before anything is dispatched — because ASKING FOR HELP REWROTE THE TREE.
 *
 * `format` and `lint` used to be dispatched above this, and `runTool` filters every `-` argument out
 * of its paths, so `--help` left none and "no paths" means the whole directory. Measured:
 * `ramonda-css format --help` rewrote a file and exited 0, having been asked what the command does.
 *
 * A person meeting a new command types `--help` first, so it is the one argument that must never do
 * work.
 */
if (argv.includes("--help") || argv.includes("-h")) {
  console.log(USAGE);
  process.exit(0);
}

/**
 * A config this cannot use is the AUTHOR's file, so it is said the way every other fault is.
 *
 * Measured before this existed: all six ways `ramonda.css.ts` can be wrong reached a person as a Node
 * crash — `throw new Error(…)`, a caret, and a stack — while the sentence inside each was careful and
 * right. A mistake in a block printed the tag, the file, the line and the sentence; a mistake in the
 * config printed a stack trace. Same tool, same person, two shapes.
 *
 * Wrapped around the WHOLE dispatch rather than around each caller, because the config is read from
 * three of them — `checkProject`, the formatter and the linter — and the next one would forget. That
 * is the reason `transform.ts` gives for holding the CSS check itself, one layer down.
 */
function said<T>(run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    console.error(`\n${TAG} ${error.message}\n`);
    process.exit(1);
  }
}

if (argv[0] === "format" || argv[0] === "lint") {
  said(() => runTool(argv[0] as "format" | "lint", argv.slice(1)));
}

/**
 * The project to check — a tsconfig, or the directory holding one, which is what `tsc -p` takes too.
 *
 * **`format` and `lint` take PATHS and this takes a project**, so `ramonda-css src/App.tsx` is the
 * mistake the command itself invites. Measured before this existed: the path went to TypeScript's
 * JSON reader, which answered `'{' expected.` at line 1 column 1 of the author's own component — a
 * message that says the source is broken when the source is fine.
 */
const given = argv.find((argument) => !argument.startsWith("-")) ?? "tsconfig.json";
const tsconfig = statSync(given, { throwIfNoEntry: false })?.isDirectory() ? join(given, "tsconfig.json") : given;

if (!tsconfig.endsWith(".json")) {
  console.error(
    `\n${TAG} \`${given}\` is not a project. This checks a whole program, so it takes a tsconfig — ` +
      `or the directory holding one — and defaults to \`tsconfig.json\` here.\n\n` +
      `  It is \`format\` and \`lint\` that take paths:\n\n` +
      `    ramonda-css format ${given}\n` +
      `    ramonda-css lint ${given}\n`,
  );
  process.exit(1);
}

const report = said(() => checkProject(tsconfig));

/**
 * Every exemption, on every run, whether or not anything failed.
 *
 * A `ramonda-css-ignore` is a decision, and a decision nobody can see is a silence — which is the
 * thing this package refuses to be. Printed here so a reason that has stopped being true is one
 * somebody meets rather than one they would have to go looking for.
 */
if (report.exempted.length > 0) {
  console.log(`\n${TAG} ${report.exempted.length} \`ramonda-css-ignore\`, honoured:\n`);
  for (const one of report.exempted) console.log(`  ${where(one.file)}:${one.line}  ${one.reason}`);
  console.log("");
}

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

  /**
   * The ARGUMENTS first, because a path that is not there is answerable without any tool — and
   * `filesUnder` reaches it through `statSync`, which throws `ENOENT`. Measured, the output was a
   * raw stack starting `node:fs:1739`. A typo in a CI script deserves a sentence.
   */
  for (const path of paths) {
    if (!existsSync(resolve(cwd, path))) {
      console.error(`\n${TAG} \`${path}\` is not there, so there is nothing to ${which}.\n`);
      process.exit(1);
    }
  }

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
    let formatted: string;
    try {
      formatted = formatText(source, resolve(cwd, named), biomeFormatter(binary, cwd));
    } catch (error) {
      if (!(error instanceof ToolFailed)) throw error;
      console.error(`\n${TAG} \`${name}\` refused:\n\n${error.message}\n`);
      process.exit(1);
    }

    /**
     * **Written SYNCHRONOUSLY, and it used to go through `process.stdout.write` and then exit.**
     *
     * A write to a pipe is asynchronous and `process.exit` does not drain one. A pipe holds 64KB, so
     * everything past that was lost. Measured on a 132,780-byte file: biome answered with all of it
     * and this handed back 65,536 bytes, cut mid-line, with no error anywhere.
     *
     * The editor extension in `vscode/` replaces the WHOLE DOCUMENT with what comes back, so saving
     * any file over 64KB deleted the rest of it — silently, on every save, in a published extension.
     *
     * `writeSync` in a loop, because a pipe accepts what it has room for and answers with how much
     * it took. The loop is the whole fix: it is what makes the write finish before the exit.
     */
    const bytes = Buffer.from(formatted, "utf8");
    for (let written = 0; written < bytes.length; ) {
      written += writeSync(1, bytes, written, bytes.length - written);
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
      // The two modes did different things and must not claim the same one: `--check` wrote to
      // nothing by design, and a write run with nothing to change wrote to nothing in fact.
      const said = check ? `${files.length} file(s) already formatted` : `${files.length} file(s), nothing to rewrite`;
      console.log(`${TAG} ${said}`);
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
  let found: ReturnType<typeof lintFile>;
  try {
    found = files.flatMap((file) => lintFile(file, lint));
  } catch (error) {
    /**
     * The tool's own words, the same as the formatter's above — and this half had no catch at all.
     *
     * It could not be reached while a failing linter came back as no findings, which is what made
     * that the more serious half of one fault: `ramonda-css lint` printed *N file(s) lint clean* and
     * exited 0 for a linter that had crashed. See `oxlintLinter`.
     */
    if (!(error instanceof ToolFailed)) throw error;
    console.error(`\n${TAG} \`${name}\` refused:\n\n${error.message}\n`);
    process.exit(1);
  }

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
