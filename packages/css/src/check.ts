import { dirname, resolve } from "node:path";
import ts from "typescript";
import { CssBlockError } from "./compiler/errors";
import { positionOf } from "./compiler/errors";
import { readBlock } from "./compiler/read";
import { checkBlock, checkText } from "./compiler/rules";
import { findBlocks, mayHoldABlock } from "./compiler/scan";
import { type VirtualFile, virtualFile } from "./compiler/virtual";

/**
 * Type-checking a whole project whose source TypeScript cannot parse.
 *
 * **Without this, the type safety is a claim about editors rather than about CI.** An editor plugin
 * is a convenience; a command that exits non-zero is what makes a wrong style block stop a build,
 * and it is the same three moves the virtual file already makes — write it, hand it to `tsc`, map
 * each diagnostic home — applied to every file a tsconfig names instead of to one string.
 *
 * ## It reports everything, not only the blocks
 *
 * A project using this syntax **cannot run plain `tsc`**: the compiler refuses the file at the parse
 * step. So this is that project's `tsc`, and a report that quietly dropped every ordinary type error
 * would be worse than no report — it would look like a passing check on a program nothing checked.
 *
 * ## The one scaffolding diagnostic that is not dropped
 *
 * A diagnostic that maps nowhere belongs to the file this wrote, and a caller drops it — except in
 * the PREAMBLE. That line declares the helper against `CssBlockShape`, and if the shape cannot be
 * resolved — the package not installed, `paths` not set, the export renamed — then every block is
 * `any`, nothing is checked, and dropping the one diagnostic that says so turns a broken setup into
 * a passing run. It is reported once, whatever the project's size.
 *
 * ## A block it cannot read stops everything
 *
 * A refusal is a syntax error, and a compiler does not type-check a program it could not parse.
 * Reporting it and carrying on would mean either serving the unreadable file to `tsc` — a cascade of
 * parse errors nobody wrote — or serving a stub, which turns one real fault into a screen of
 * "has no exported member". So a refusal is reported alone, and the type check does not run.
 */

export interface CheckOptions {
  /** Where the block shape is imported from. A test points this at a fixture. */
  readonly properties?: string;
}

export interface Finding {
  /** Absolute, the way a compiler prints it. */
  readonly file: string;
  /** 1-based, the way an editor counts. */
  readonly line: number;
  readonly column: number;
  /**
   * The TypeScript code, `0` for a block this could not read, or the CSS rule's own id.
   *
   * Two kinds of finding in one list on purpose: an author reads a file, not a tool, and a property
   * typo beside a type error is one list of things to fix.
   */
  readonly code: number | string;
  readonly message: string;
}

export interface Report {
  /** Files the tsconfig named. */
  readonly files: number;
  /** How many of them carry at least one block. */
  readonly styled: number;
  readonly findings: readonly Finding[];
  /** A block could not be read, so nothing was type-checked. */
  readonly refused: boolean;
}

export function checkProject(tsconfig: string, options: CheckOptions = {}): Report {
  const configPath = resolve(tsconfig);
  const parsed = parseConfig(configPath);
  if ("findings" in parsed) return parsed;

  /** The overlay and the text it was built from, together — one lookup, and no half-set state. */
  const overlays = new Map<string, { virtual: VirtualFile; source: string }>();
  const refusals: Finding[] = [];
  /** What the CSS rules found — the faults the types deliberately cannot catch. */
  const css: Finding[] = [];

  for (const fileName of parsed.fileNames) {
    const text = ts.sys.readFile(fileName);
    if (text === undefined || !mayHoldABlock(text)) continue;

    try {
      const virtual = virtualFile(text, { properties: options.properties });
      // `mayHoldABlock` is allowed to say maybe — a string or a comment can hold the syntax, and
      // a file that turns out to hold no block needs no overlay.
      if (virtual !== undefined) {
        overlays.set(fileName, { virtual, source: text });
        css.push(...cssFindings(fileName, text));
      }
    } catch (error) {
      // A refusal is ours and is reported. Anything else is a bug in this package and must not be
      // dressed up as one of the author's faults.
      if (!(error instanceof CssBlockError)) throw error;
      refusals.push({ file: fileName, line: error.line, column: error.column, code: 0, message: error.message });
    }
  }

  if (refusals.length > 0) {
    return { files: parsed.fileNames.length, styled: overlays.size, findings: refusals, refused: true };
  }

  const program = ts.createProgram(parsed.fileNames, { ...parsed.options, noEmit: true }, overlaying(parsed, overlays));

  const findings: Finding[] = [];
  /** Setup faults, by message, so a project of any size reports each of them once. */
  const setup = new Map<string, Finding>();

  for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
    const finding = place(diagnostic, configPath, overlays, setup);
    if (finding !== undefined) findings.push(finding);
  }

  return {
    files: parsed.fileNames.length,
    styled: overlays.size,
    findings: [...setup.values(), ...inOrder(css, findings)],
    refused: false,
  };
}

/**
 * The two kinds of finding as one list, in the order a person reads a file — and with the compiler's
 * word dropped where a rule of ours said the same thing better.
 *
 * `TS2353` is *"does not exist in type"*, which is exactly what `unknown-property` says — and the
 * rule says it with the near miss the compiler cannot offer, because a QUOTED object key gets no
 * suggestion. Measured before this existed: `flex-dirction` was reported twice, once usefully.
 *
 * Matched on POSITION rather than on text: the same fault at the same character is the same fault,
 * and a `TS2353` about a nested rule's key is at a position no property rule names, so it survives.
 */
function inOrder(css: readonly Finding[], types: readonly Finding[]): Finding[] {
  const said = new Set(css.filter((finding) => finding.code === "unknown-property").map((finding) => at(finding)));

  return [...css, ...types.filter((finding) => !(finding.code === 2353 && said.has(at(finding))))].sort(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column,
  );
}

const at = (finding: Finding) => `${finding.file}:${finding.line}:${finding.column}`;

/**
 * What the CSS rules say about one file's blocks.
 *
 * A second parse of the same file, and it is worth it: the rules read a `Block`, the virtual file
 * emits TSX from one, and threading the parse through both would tie the two together for a saving
 * that is a fraction of the type check either way.
 *
 * STRICT, like everything else the build path does. A block the parser refuses has already been
 * reported as a refusal and the run has stopped.
 */
function cssFindings(fileName: string, source: string): Finding[] {
  const out: Finding[] = [];

  for (const site of findBlocks(source)) {
    const read = readBlock(source, site.open, fileName);
    // The text and the parse, because one of them has no name for a `//` — see `checkText`.
    for (const finding of [...checkText(source, site.open, read.end), ...checkBlock(read.block)]) {
      out.push({ file: fileName, ...positionOf(source, finding.at), code: finding.rule, message: finding.message });
    }
  }

  return out;
}

/**
 * One diagnostic, in the author's own coordinates — or nothing, when it belongs to the file this
 * wrote rather than to the one they did.
 */
function place(
  diagnostic: ts.Diagnostic,
  configPath: string,
  overlays: Map<string, { virtual: VirtualFile; source: string }>,
  setup: Map<string, Finding>,
): Finding | undefined {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, " ");

  // A diagnostic about the configuration has no file. It is still a reason to fail.
  if (diagnostic.file === undefined || diagnostic.start === undefined) {
    return { file: configPath, line: 1, column: 1, code: diagnostic.code, message };
  }

  const fileName = diagnostic.file.fileName;
  const overlay = overlays.get(fileName);

  if (overlay === undefined) {
    const at = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
    return { file: fileName, line: at.line + 1, column: at.character + 1, code: diagnostic.code, message };
  }

  const home = overlay.virtual.homeOf(diagnostic.start);
  if (home !== undefined) {
    return { file: fileName, ...positionOf(overlay.source, home), code: diagnostic.code, message };
  }

  /**
   * In the preamble, so it is about the type every block is checked against. Not dropped: if the
   * shape cannot be resolved, every block is `any` and a silent pass is the worst answer here.
   */
  if (diagnostic.start < overlay.virtual.preamble) {
    setup.set(message, { file: fileName, line: 1, column: 1, code: diagnostic.code, message });
  }

  // Everything else this file wrote: the helper, the punctuation between declarations.
  return undefined;
}

/**
 * The compiler host, with the virtual files standing in for the ones on disk.
 *
 * Both `getSourceFile` and `readFile` are overlaid, and the file NAME is unchanged: an import
 * resolves from where the author's file really is, so nothing about module resolution moves.
 */
function overlaying(
  parsed: ts.ParsedCommandLine,
  overlays: Map<string, { virtual: VirtualFile; source: string }>,
): ts.CompilerHost {
  const host = ts.createCompilerHost(parsed.options);
  const readFromDisk = host.readFile.bind(host);
  const sourceFromDisk = host.getSourceFile.bind(host);

  host.readFile = (name) => overlays.get(name)?.virtual.code ?? readFromDisk(name);
  host.getSourceFile = (name, language, onError, shouldCreate) => {
    const overlay = overlays.get(name);
    if (overlay === undefined) return sourceFromDisk(name, language, onError, shouldCreate);
    return ts.createSourceFile(name, overlay.virtual.code, language, true, ts.ScriptKind.TSX);
  };

  return host;
}

/** The tsconfig, or a report saying why there is nothing to check. */
function parseConfig(configPath: string): ts.ParsedCommandLine | Report {
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  if (read.error !== undefined) {
    const message = ts.flattenDiagnosticMessageText(read.error.messageText, " ");
    return {
      files: 0,
      styled: 0,
      refused: true,
      findings: [{ file: configPath, line: 1, column: 1, code: read.error.code, message }],
    };
  }

  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, dirname(configPath), undefined, configPath);
  if (parsed.errors.length > 0) {
    return {
      files: 0,
      styled: 0,
      refused: true,
      findings: parsed.errors.map((error) => ({
        file: configPath,
        line: 1,
        column: 1,
        code: error.code,
        message: ts.flattenDiagnosticMessageText(error.messageText, " "),
      })),
    };
  }

  return parsed;
}
