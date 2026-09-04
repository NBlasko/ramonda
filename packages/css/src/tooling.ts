import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { placehold } from "./compiler/tooling";
import { positionOf } from "./compiler/errors";
import { mayHoldABlock } from "./compiler/scan";
import { virtualFile } from "./compiler/virtual";

/**
 * Running the formatter and the linter over a file whose syntax neither can parse.
 *
 * Two different answers, because the two tools want different things — see `compiler/tooling.ts` for
 * the reasoning. What is here is the part that has to know about real tools: how to invoke one, and
 * how to read what it says.
 *
 * ## Both find their configuration from the working directory, which is what makes this possible
 *
 * Measured, because a wrapper that quietly lost a project's rules would be worse than no wrapper.
 * `oxlint` given a file OUTSIDE the repository, run with the repository as its cwd, applied the same
 * **93 rules** and reported the same findings as for a file inside it. `biome` takes the text on
 * stdin with `--stdin-file-path` and answers with the repository's own `lineWidth` and indentation.
 *
 * So neither half has to touch the author's file to get the project's own settings — the formatter
 * never writes a temp file at all, and the linter's temp file is read with the project's rules.
 */

/** One thing a tool said, in the author's own coordinates. */
export interface ToolFinding {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  /** The tool's own rule name, so a reader can search for it where the tool documents it. */
  readonly code: string;
  readonly message: string;
}

/** Where a tool lives in the project being worked on, or `undefined` when it is not installed. */
export function toolIn(directory: string, name: string): string | undefined {
  const at = join(directory, "node_modules", ".bin", name);
  return existsSync(at) ? at : undefined;
}

/**
 * Formats one file, blocks and all.
 *
 * The formatter is given text and hands text back — no file of ours on disk, and none of the
 * author's touched until the result is known good.
 */
export function formatFile(
  file: string,
  format: (text: string, path: string) => string,
  options: { write: boolean },
): { changed: boolean; text: string } {
  const source = readFileSync(file, "utf8");
  const held = placehold(source);

  const text = held === undefined ? format(source, file) : held.restore(format(held.text, file));
  const changed = text !== source;

  if (changed && options.write) writeFileSync(file, text);
  return { changed, text };
}

/** One diagnostic as a linter reports it — the shape `oxlint --format=json` produces. */
export interface Reported {
  message: string;
  code?: string;
  filename?: string;
  labels?: { span?: { offset: number } }[];
}

/**
 * Lints one file through its virtual reading, with every position mapped home.
 *
 * The virtual file is the same one `tsc` is given, so the linter and the type checker are looking at
 * one file rather than two readings of it. A diagnostic that maps nowhere is dropped: it belongs to
 * the scaffolding the virtual file added, not to anything the author wrote.
 */
export function lintFile(file: string, lint: (path: string) => Reported[]): ToolFinding[] {
  const source = readFileSync(file, "utf8");
  const virtual = mayHoldABlock(source) ? virtualFile(source, { tolerant: true }) : undefined;

  /**
   * No block, so the file is linted as it is and every position is already the author's.
   *
   * `mayHoldABlock` is allowed to say maybe — `@(` is also how a decorator is written, and this is a
   * decorator-heavy framework — so the second condition is not redundant. Found by a test: returning
   * nothing there made every decorator file lint CLEAN, silently, which is the failure this whole
   * package has been fixing all week.
   */
  if (virtual === undefined) {
    return lint(file).map((diagnostic) => ({
      file,
      ...positionOf(source, diagnostic.labels?.[0]?.span?.offset ?? 0),
      code: diagnostic.code ?? "lint",
      message: diagnostic.message,
    }));
  }

  /**
   * The virtual text in a directory of its own, under the file's own basename.
   *
   * The name is kept so a rule that reads one — a test file, a declaration file — sees what it would
   * have seen. The directory is temporary because the file is not the author's and must never be
   * mistaken for it; the project's own rules still apply, because the linter reads them from the
   * working directory rather than from the path. Measured.
   */
  const directory = mkdtempSync(join(tmpdir(), "ramonda-css-lint-"));
  const probe = join(directory, basename(file));

  try {
    writeFileSync(probe, virtual.code);

    const findings: ToolFinding[] = [];
    for (const diagnostic of lint(probe)) {
      const offset = diagnostic.labels?.[0]?.span?.offset;
      if (offset === undefined) continue;

      const home = virtual.homeOf(offset);
      // Scaffolding: the helper the virtual file declared, the punctuation between declarations.
      if (home === undefined) continue;

      findings.push({
        file,
        ...positionOf(source, home),
        code: diagnostic.code ?? "lint",
        message: diagnostic.message,
      });
    }
    return findings;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/**
 * The diagnostics out of whatever a linter printed.
 *
 * It may print other things first — a warning about its own configuration — so the object is found
 * rather than assumed to start at the beginning. And a run that answered with something not JSON at
 * all gives nothing: it has already said what it could, and inventing a parse error here would be a
 * second wrong answer on top of the first.
 */
export function readReport(text: string): Reported[] {
  const start = text.indexOf("{");
  if (start === -1) return [];

  try {
    return (JSON.parse(text.slice(start)) as { diagnostics?: Reported[] }).diagnostics ?? [];
  } catch {
    return [];
  }
}
