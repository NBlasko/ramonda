import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { type Reported, type Tool, readReport } from "./tooling";

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
/**
 * How much a tool is allowed to say, and the default is not enough.
 *
 * `execFileSync` stops at `maxBuffer` — a megabyte by default — and throws. Both tools reach it:
 * biome answers with the whole FORMATTED FILE on stdout, and a lint report is JSON of the same
 * order. Measured with the real biome: a 1.87 MB source (60,000 lines) failed, and the "error" was
 * a megabyte of the author's own code, cut off mid-line.
 *
 * The linter's version is the one that decides this number: it reads its report off the failure, so
 * a truncated one is unparsable JSON, which is no findings, which is a file that lints CLEAN.
 *
 * Bounded rather than `Infinity`, because a tool that never stops printing should fail rather than
 * take the machine with it. Sixty-four megabytes is far past any source file anybody formats.
 */
const MAX_OUTPUT = 64 * 1024 * 1024;

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
export function biomeFormatter(tool: Tool, cwd: string): (text: string, path: string) => string {
  return (text, path) => {
    try {
      return execFileSync(tool.command, [...tool.args, "format", `--stdin-file-path=${asIfNamed(path)}`], {
        cwd,
        input: text,
        encoding: "utf8",
        maxBuffer: MAX_OUTPUT,
      });
    } catch (error) {
      /**
       * The formatter's own words, not a stack trace of ours: a formatter can fail for reasons that
       * have nothing to do with this — a config it cannot read, a version that is not installed —
       * and a wrapper answering with its own call stack would hide the only useful sentence.
       */
      const failed = error as { stderr?: string; stdout?: string };
      throw new ToolFailed(`${failed.stderr ?? ""}${failed.stdout ?? ""}`.trim() || String(error));
    }
  };
}

/**
 * Oxlint, as JSON.
 *
 * It exits non-zero when it finds something, so the report is read off the failure as well — an
 * exit code is the answer here, not an error.
 *
 * **But the ABSENCE of a report is not evidence of a clean file.** `readReport` answers `[]` for
 * anything it cannot parse, so a linter that crashed, that printed why it could not run, or that
 * was not installed at all would come back as no findings, and `ramonda-css lint` would print *N
 * file(s) lint clean* and exit 0. It is the same shape the `maxBuffer` note names: unparsable
 * output is no findings, which is a file that lints CLEAN.
 *
 * So a failure with nothing parsable in it is a `ToolFailed`, carrying the tool's own words, the
 * same as `biomeFormatter` on the same binary.
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

export function oxlintLinter(tool: Tool, cwd: string): (path: string) => Reported[] {
  return (path) => {
    try {
      return readReport(
        execFileSync(tool.command, [...tool.args, "--format=json", path], {
          cwd,
          encoding: "utf8",
          maxBuffer: MAX_OUTPUT,
        }),
      );
    } catch (error) {
      const failed = error as { stdout?: string; stderr?: string };
      const said = failed.stdout ?? "";
      // A report is what a non-zero exit means when there is one in the output. Anything else is the
      // tool failing, and a failure that answered "no findings" is a file that lints clean.
      if (said.includes("{")) return readReport(said);
      throw new ToolFailed(`${failed.stderr ?? ""}${said}`.trim() || String(error));
    }
  };
}

/**
 * Biome, for a project whose linter is biome.
 *
 * **Three flags, each measured on biome 2.5.**
 *
 * - `--vcs-use-ignore-file=false`: the copy of a file with a block lives OUTSIDE the project, and
 *   with the ignore file in use biome stops on such a path with an internal error ("This is a bug in
 *   Biome"). Off, it lints the copy with the project's own rules — a rule the project switched off
 *   stays off, which the tests ask of the real binary.
 * - `--reporter=json`, which biome calls experimental and free to change in a patch. So output this
 *   cannot read is a `ToolFailed`, never a clean file — the same rule as oxlint's.
 * - `--max-diagnostics=none`: biome prints twenty by default, and the rest of a file's findings
 *   would be dropped without a word.
 *
 * Biome reports a LINE and a COLUMN, where the rest of this module speaks offsets, so each is turned
 * into one against the file that was linted.
 *
 * **Always a copy, never the file in place.** A project hands its sources to this wrapper and keeps
 * them out of biome's own run, because `biome lint .` cannot read a block — and biome answers a path
 * its config excludes with an empty report. Linted in place, every file without a block would come
 * back clean. The copy keeps the basename, and the project's rules still reach it (see above).
 */
export function biomeLinter(tool: Tool, cwd: string): (path: string) => Reported[] {
  return (path) => {
    const directory = mkdtempSync(join(tmpdir(), "ramonda-css-biome-"));
    const copy = join(directory, basename(path));
    try {
      copyFileSync(path, copy);
      return biomeReport(tool, cwd, copy);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  };
}

/** One run of biome's linter over one file it may lint, as findings with offsets. */
function biomeReport(tool: Tool, cwd: string, path: string): Reported[] {
  let said: string;
  try {
    said = execFileSync(
      tool.command,
      [...tool.args, "lint", "--vcs-use-ignore-file=false", "--reporter=json", "--max-diagnostics=none", path],
      { cwd, encoding: "utf8", maxBuffer: MAX_OUTPUT, stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string };
    said = failed.stdout ?? "";
    if (!said.includes("{")) throw new ToolFailed(`${failed.stderr ?? ""}${said}`.trim() || String(error));
  }

  let report: { diagnostics?: BiomeDiagnostic[] };
  try {
    report = JSON.parse(said.slice(said.indexOf("{")));
  } catch {
    throw new ToolFailed(`biome printed a report this cannot read:\n${said.slice(0, 400)}`);
  }
  if (!Array.isArray(report.diagnostics))
    throw new ToolFailed(`biome printed no diagnostics list:\n${said.slice(0, 400)}`);

  const text = readFileSync(path, "utf8");
  const lineStarts = [0];
  for (let index = 0; index < text.length; index++) if (text[index] === "\n") lineStarts.push(index + 1);

  return report.diagnostics.map((diagnostic) => {
    const start = diagnostic.location?.start;
    const offset =
      start === undefined ? undefined : (lineStarts[start.line - 1] ?? text.length) + Math.max(start.column - 1, 0);
    return {
      message: diagnostic.message ?? diagnostic.description ?? "",
      code: diagnostic.category,
      ...(offset === undefined ? {} : { labels: [{ span: { offset } }] }),
    };
  });
}

/** One entry of biome's JSON report — what this reads of it. */
interface BiomeDiagnostic {
  message?: string;
  description?: string;
  category?: string;
  location?: { start?: { line: number; column: number } };
}
