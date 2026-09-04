import { execFileSync } from "node:child_process";
import { type Reported, readReport } from "./tooling";

/**
 * Invoking the two tools this knows how to drive.
 *
 * **Nothing here decides anything.** `tooling.ts` makes every decision and is tested with a tool that
 * does exactly what a test says. What is left is "run this binary and read what came out", which
 * cannot be tested without running it — `__tests__/toolingCli.test.ts` does, against the real biome
 * and the real oxlint, which is also the only way to know they accept what they are handed.
 *
 * ## Both find their configuration from the working directory, and that is what makes this possible
 *
 * Measured, because a wrapper that quietly lost a project's rules would be worse than no wrapper.
 * `oxlint` given a file OUTSIDE the repository, run with the repository as its cwd, applied the same
 * **93 rules** and reported the same findings as for a file inside it. `biome` takes the text on
 * stdin with `--stdin-file-path` and answers with the project's own `lineWidth` and indentation.
 *
 * So neither half has to touch the author's file to get the project's own settings: the formatter
 * never writes a temp file at all, and the linter's temp file is read with the project's rules.
 */

/**
 * A tool said no. Its own message, so a caller can print that rather than a stack.
 *
 * Here rather than beside the decisions, because this is the only place that throws one — and it can
 * only be reached by a tool that really refuses, which is a subprocess test's question.
 */
export class ToolFailed extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolFailed";
  }
}

/**
 * Biome, over stdin.
 *
 * `--stdin-file-path` is what makes the formatter half work without a temp file: biome decides the
 * language from that name and the settings from the working directory, and answers on stdout.
 *
 * **The name it is given is not quite the file's, and that is measured.** A project holding a style
 * block has to exclude that file from `biome format .`, or the run fails at the parse step — and
 * biome consults the same exclusion for a stdin path, so the wrapper's own call was skipped in
 * silence: *"The content was not formatted because the path is ignored"*, the text handed back
 * unchanged, and a `--check` that passed having done nothing.
 */
export function biomeFormatter(binary: string, cwd: string): (text: string, path: string) => string {
  return (text, path) => {
    try {
      return execFileSync(binary, ["format", `--stdin-file-path=${asIfNamed(path)}`], {
        cwd,
        input: text,
        encoding: "utf8",
      });
    } catch (error) {
      /**
       * The formatter's own words, not a stack trace of ours.
       *
       * Found by a broken fixture, and it is a real gap either way: a formatter can fail for reasons
       * that have nothing to do with this — a config it cannot read, a version that is not installed
       * — and a wrapper answering with its own call stack has hidden the only useful sentence.
       */
      const failed = error as { stderr?: string; stdout?: string };
      throw new ToolFailed(`${failed.stderr ?? ""}${failed.stdout ?? ""}`.trim() || String(error));
    }
  };
}

/**
 * Oxlint, as JSON.
 *
 * It exits non-zero when it finds something, so the report is read off the failure as well — an exit
 * code is the answer here, not an error.
 */
/**
 * The same file, under a name no exclusion for it can match.
 *
 * The DIRECTORY is kept and so is the extension, which is everything biome decides from a path: the
 * language, and any `overrides` a project has written. Only the basename differs, and only by enough
 * that a rule naming the real file does not claim this.
 */
function asIfNamed(path: string): string {
  return path.replace(/([^./\\]+)(\.[cm]?[jt]sx?)$/, "$1.ramonda-css$2");
}

export function oxlintLinter(binary: string, cwd: string): (path: string) => Reported[] {
  return (path) => {
    try {
      return readReport(execFileSync(binary, ["--format=json", path], { cwd, encoding: "utf8" }));
    } catch (error) {
      return readReport((error as { stdout?: string }).stdout ?? "");
    }
  };
}
