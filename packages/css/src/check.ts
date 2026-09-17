import { dirname, resolve } from "node:path";
import ts from "typescript";
import { CssBlockError } from "./compiler/errors";
import { REPLACED_CODES, SPEAKS_OVER_TYPES } from "./compiler/rules";
import { Sheet, messageFor } from "./compiler/sheet";
import { checkedSource } from "./compiler/source";
import { positionOf } from "./compiler/errors";
import { knownNames, configReader, environmentOf } from "./config";
import { findConfig } from "./config";
import { propertiesFor } from "./generate";
import { readModule } from "./modules";
import { fileMayHoldABlock, mayHoldABlock } from "./compiler/scan";
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
  /**
   * Every `ramonda-css-ignore` the run honoured, with the reason the author gave.
   *
   * Returned rather than swallowed, and printed on every run: an exemption is a decision, and a
   * decision nobody can see is a silence. A reason that stops being true is then one somebody meets
   * rather than one they would have to grep for.
   */
  readonly exempted: readonly { file: string; line: number; reason: string }[];
}

export function checkProject(tsconfig: string, options: CheckOptions = {}): Report {
  const configPath = resolve(tsconfig);
  const parsed = parseConfig(configPath);
  if ("findings" in parsed) return parsed;

  /**
   * The project's own settings, found from EACH FILE rather than once from beside the tsconfig.
   *
   * Not from the working directory — `ramonda-check` is run from wherever somebody happens to be,
   * and a config found relative to the shell would make the answer depend on where the command was
   * typed. But the tsconfig's directory is not right either: one tsconfig in a monorepo names files
   * in several packages, and a package's own `ramonda.css.ts` is the file the editor reads for
   * them. Anchored on the file, this tool and the editor cannot disagree. See {@link configReader}.
   */
  const configFor = configReader(ts, environmentOf());

  /** The overlay and the text it was built from, together — one lookup, and no half-set state. */
  const overlays = new Map<string, { virtual: VirtualFile; source: string }>();
  const refusals: Finding[] = [];
  /** What the CSS rules found — the faults the types deliberately cannot catch. */
  const css: Finding[] = [];
  /** Only the variables are wanted from it — see below. */
  const sheet = new Sheet();
  const sources = new Map<string, string>();
  /** What the author took responsibility for — see {@link Report.exempted}. */
  const exempted: { file: string; line: number; reason: string }[] = [];

  for (const fileName of parsed.fileNames) {
    if (!fileMayHoldABlock(fileName)) continue;
    const text = ts.sys.readFile(fileName);
    if (text === undefined || !mayHoldABlock(text)) continue;

    try {
      /**
       * **The same reader BOTH halves of this command use**, and it used to be given to one of them.
       *
       * `Imported.read` says why it is injected: "a virtual file that resolved less than the build
       * would type-check an expression the build never emits — and report a name the author was
       * right to write." `checkedSource` below was given it; this was not, so the type half resolved
       * less than the build. Measured through the real command, on a file that compiles:
       *
       *     1 block(s) could not be read, so nothing was checked
       *     src/Card.tsx:2:25  a hole cannot be a whole declaration … The one name a hole may stand
       *                        in is a `@@property( … )` declared in this file.
       *
       * It IS declared, in the module beside it, and the build resolves it — a reference to a named
       * site is written into the text at compile time rather than carried as a hole, which is the
       * only thing that makes a `var()` of one resolve at all. So the CI gate refused a shared
       * theme, with a message saying the author should have done what they had done.
       *
       * The `filename` goes with it: a relative specifier is resolved against the file holding the
       * import, so a reader with nothing to resolve against reads nothing.
       */
      /**
       * The project's OWN property map when it has generated one, and the shipped map otherwise.
       *
       * An explicit `properties` option still wins — a fixture, a wrapper's own — because a caller
       * that named one meant it.
       */
      const properties = options.properties ?? propertiesFor(fileName);
      const virtual = virtualFile(text, { properties, filename: fileName, read: readModule });
      // `mayHoldABlock` is allowed to say maybe — a string or a comment can hold the syntax, and
      // a file that turns out to hold no block needs no overlay.
      if (virtual !== undefined) {
        overlays.set(fileName, { virtual, source: text });
        const config = configFor(fileName);
        const walked = checkedSource(text, fileName, { read: readModule, config });
        css.push(
          ...walked.findings.map((finding) => ({
            file: fileName,
            ...positionOf(text, finding.at),
            code: finding.rule,
            message: finding.message,
          })),
        );
        sheet.add(fileName, [], { ...walked.variables, known: knownNames(config) });
        sources.set(fileName, text);
        for (const one of walked.ignored) exempted.push({ file: fileName, line: one.line, reason: one.reason });
      }
    } catch (error) {
      // A refusal is ours and is reported. Anything else is a bug in this package and must not be
      // dressed up as one of the author's faults.
      if (!(error instanceof CssBlockError)) throw error;
      refusals.push({ file: fileName, line: error.line, column: error.column, code: 0, message: error.message });
    }
  }

  /**
   * The question no single file can answer, asked where every file is in — see
   * `Sheet.unknownVariables`. A `Sheet` with no rules in it, because only the variables are wanted:
   * the classes are the build's business and this command does not emit one.
   *
   * Reported as a FINDING at the name's own position, not as a refusal. A refusal means the parser
   * could not read a block, and saying that about a name that reads fine would send a person looking
   * at the wrong thing.
   */
  for (const one of sheet.unknownVariables()) {
    const source = sources.get(one.file);
    css.push({
      file: one.file,
      ...(source === undefined ? { line: 1, column: 1 } : positionOf(source, one.read.at)),
      code: "variable-not-set",
      message: messageFor(one),
    });
  }

  if (refusals.length > 0) {
    return { files: parsed.fileNames.length, styled: overlays.size, findings: refusals, refused: true, exempted };
  }

  /**
   * **The project's own `ramonda.css.ts` is type-checked, and a `tsconfig` will not have included
   * it.**
   *
   * `defineConfig` exists so that a config is checked as it is written — a property CSS does not
   * have, an arity CSS does not give, a unit that is not one, each refused on the line. None of that
   * runs if the file is not in the PROGRAM, and it usually is not: a config sits at the project root
   * and an ordinary `include` is `["src"]`. Measured on this repository's own playground, where four
   * deliberately wrong configs were written and every one compiled.
   *
   * Reported by the user, in their words: *"ramonda.css.ts fajl nema onaj tipo sto sam zeleo da ne
   * moram magicno da mislim i pisem konfig."*
   *
   * Added here rather than asked of every project's `tsconfig.json`, because a manual step that
   * every project needs is a step most projects will not have.
   */
  const settings = findConfig(dirname(configPath));
  const roots =
    settings === undefined || parsed.fileNames.includes(settings) ? parsed.fileNames : [...parsed.fileNames, settings];

  const program = ts.createProgram(roots, { ...parsed.options, noEmit: true }, overlaying(parsed, overlays));

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
    findings: [...setup.values(), ...inOrder(css, findings, sources)],
    refused: false,
    exempted,
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
 * and a `TS2353` about a nested rule's key is at a position no rule of ours names, so it survives.
 *
 * **ANY rule of ours, and it used to be `unknown-property` alone.** Every other rule that speaks
 * where TypeScript also refuses the key left two errors for one mistake, and the compiler's was the
 * worse one. Measured on a `//` comment:
 *
 *     line-comment: CSS has no `//` comment — … Write a block comment instead.
 *     TS2353: … and '"// the palette is in flux\n  gap"' does not exist in type 'CssBlockShape'.
 *
 * The second quotes the comment and the NEXT property mashed into one key, newline spelt out. The
 * principle above was already right; only the filter was narrow. Swept across twelve faults, the
 * comment is the one that doubled — so this is a widening of the same rule rather than a case for
 * `//`, because the next rule to land on a key would have doubled too.
 */
function inOrder(css: readonly Finding[], types: readonly Finding[], sources: ReadonlyMap<string, string>): Finding[] {
  const said = new Set(css.map((finding) => at(finding)));
  const where = declarations(sources);

  /**
   * A line where a HOLE's own value was refused, so the property's complaint about it is dropped.
   *
   * The pair appears the moment a property says what it takes. `__val` constrains a hole to
   * `CssValue`; when the expression fails that, TypeScript reports it on the expression — the
   * actionable one — and then falls back to the CONSTRAINT as the call's type, which a narrowed
   * property refuses in turn. Measured on `color: {maybe}` where `maybe` is `string | undefined`:
   *
   *     TS2322 3:3   Type 'CssValue' is not assignable to type 'Narrowed<never, CssColor | …>'
   *     TS2345 3:11  Argument of type 'undefined' is not assignable to parameter of type 'CssValue'
   *
   * Two messages for one mistake, and the first names a type the author never wrote. It is the same
   * fault `TS2353` had above, arriving from the other direction, so it is answered the same way.
   *
   * Matched on the message rather than on position alone, because `Type 'CssValue' is not
   * assignable` can only come from a hole falling back to its constraint — a value the author wrote
   * out is reported as its own type, never as `CssValue`.
   */
  const holeRefused = new Set(
    types.filter((finding) => finding.code === 2345 && finding.message.includes("CssValue")).map(where),
  );

  /**
   * A LINE where a `$` path was refused by a rule of ours, so the compiler's word about it goes.
   *
   * Measured, one typo came back twice, at two columns, with the same suggestion in each:
   *
   *     unknown-variable  `$.space.gutter.norml` is not a variable this project declares.
   *                       Did you mean `$.space.gutter.normal`?
   *     TS2551            Property 'norml' does not exist on type
   *                       'Readonly<{ normal: Token<"length", "16px">; }>'. Did you mean 'normal'?
   *
   * Ours is the one kept: it names the whole path the author wrote and says *this project*, where
   * the compiler names the last segment and a generated type. Three shapes of the same fault, and
   * the compiler spells each differently — `TS2551` for a near miss, `TS2339` for a segment near
   * nothing, `TS2322` for a GROUP, which is a real member whose type no property accepts.
   *
   * **By line, not by character**, which is the one place this departs from the note above. The two
   * land at different columns by construction: ours spans the whole path from the `$`, the
   * compiler's sits on the segment that failed. A `$` path does not span lines, so the line is the
   * fault's own extent here.
   *
   * **And the rule is not deleted**, which was the first idea and would have been wrong. It is the
   * only thing that speaks in the BUILD — vite and esbuild run these rules over a block and never
   * run TypeScript over it, so a `var()` into a name nothing sets would compile clean.
   */
  const pathRefused = new Set(css.filter((finding) => finding.code === "unknown-variable").map(where));

  /**
   * A LINE where a literal was refused by `variablesOnly`, so the compiler's word about it goes.
   *
   * Both machineries speak here, and both must: the TYPE is what an editor squiggles as you type,
   * and the RULE is the only one the BUILD runs — vite and esbuild never type-check a block. What
   * an author must not get is the pair, and measured they did: twelve reports for six faults.
   *
   * Ours is kept. `Narrowed<never, 0 | "0" | Token<"length" | "percentage" | …>>` names neither the
   * project, nor `ramonda.css.ts`, nor the way out; the rule names all three. By line for the same
   * reason as above — the two land at different columns by construction, ours on the value and the
   * compiler's on the property.
   */
  const literalRefused = new Set(
    css.filter((finding) => (SPEAKS_OVER_TYPES as readonly string[]).includes(String(finding.code))).map(where),
  );

  const kept = types.filter((finding) => {
    if (finding.code === 2353 && said.has(at(finding))) return false;
    if (finding.code === 2322 && finding.message.startsWith("Type 'CssValue' is not assignable")) {
      return !holeRefused.has(where(finding));
    }
    if (finding.code === 2551 || finding.code === 2339 || finding.code === 2322) {
      if (pathRefused.has(where(finding))) return false;
    }
    /**
     * `TS2353` too, because a shorthand switched off is REMOVED from the map rather than narrowed —
     * so the compiler's word about it is *does not exist in type*, not *is not assignable*.
     */
    /**
     * `TS2561` too, which is the compiler's *did you mean* for a bare property name. `unknown-property`
     * speaks for those since pass 6, so that the BUILD sees them — and two reports for one typo is
     * the fault this whole filter exists for.
     */
    if (
      typeof finding.code === "number" &&
      REPLACED_CODES.includes(finding.code) &&
      literalRefused.has(where(finding))
    ) {
      return false;
    }
    return true;
  });

  return [...css, ...kept].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column);
}

const at = (finding: Finding) => `${finding.file}:${finding.line}:${finding.column}`;

/**
 * Where a finding sits, as the DECLARATION that holds it rather than as the line.
 *
 * The three sets above drop the compiler's word where a rule of ours already spoke for the same
 * fault, and they cannot use the position: the two land at different columns by construction — ours
 * on the value or on the whole `$` path, the compiler's on the property or on the segment that
 * failed. The line was the next thing up, and it was too much. A line holds as many declarations as
 * an author cares to write, and measured, `padding-left: $.size.control.mdd; color: $.size.control.md;`
 * reported ONE problem: the typo suppressed the KIND mismatch beside it, which nothing else catches
 * — a kind is a type, not a rule the build runs, so that fault left the tool altogether.
 *
 * A declaration is the extent a fault really has. Both messages about one fault fall inside one;
 * the next declaration on the same line is a different fault and keeps its own.
 *
 * **A declaration that SPANS lines is not joined up here**, so a property on one line and its value
 * on the next get both messages. That is what the line key did too — it is left as it was rather
 * than widened blind, because the shapes this exists for (`$` paths, quoted values, property names)
 * cannot span lines.
 */
function declarations(sources: ReadonlyMap<string, string>): (finding: Finding) => string {
  const lines = new Map<string, readonly string[]>();

  return (finding) => {
    let split = lines.get(finding.file);
    if (split === undefined) {
      split = sources.get(finding.file)?.split("\n") ?? [];
      lines.set(finding.file, split);
    }

    const line = split[finding.line - 1] ?? "";
    let start = 0;
    /**
     * The last `;` BEFORE the finding opens the declaration it is in.
     *
     * A brace is NOT a separator here, though a nested rule uses one: a HOLE is written in braces
     * too, and measured, counting them split one fault's two messages into two declarations — the
     * `TS2345` inside `color: {this.maybe}` landed after the brace and the property's `TS2322`
     * before it, so the pair this filter exists to collapse came back. A `;` ends every declaration
     * a nested rule holds, so the brace earns nothing the semicolon does not already give.
     */
    for (let index = 0; index < finding.column - 1 && index < line.length; index++) {
      if (line[index] === ";") start = index + 1;
    }
    return `${finding.file}:${finding.line}:${start}`;
  };
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
      exempted: [],
      findings: [{ file: configPath, line: 1, column: 1, code: read.error.code, message }],
    };
  }

  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, dirname(configPath), undefined, configPath);
  if (parsed.errors.length > 0) {
    return {
      files: 0,
      styled: 0,
      refused: true,
      exempted: [],
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
