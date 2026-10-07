import { type Config } from "../../config/config";
import { type VirtualFile } from "../virtual";
import { allowListIsAnInterface, allowListNotCss, stateIsATuple } from "./allowList";
import { castToABlock } from "./cast";
import { joinedNotMerged } from "./joined";
import { neverUsed, overriddenBelow } from "./styleProp";
import { styleMakesOneUp, styleSetsADeclared } from "./styleAttribute";
import ts from "typescript";
import { wholeAcrossBlocks } from "./cascade";

/**
 * The rules that need a `ts.Program`, which is what separates them from every rule in `rules/`.
 *
 * ## Why they cannot live beside the others
 *
 * A rule in `rules/` reads a parsed `Block` and nothing else — no value to follow, no declaration
 * to resolve. Every rule here asks what a CALLER was promised, and the promise is written in a
 * type. So they need the checker, and putting them beside the others would make every rule pay for
 * a program that almost none of them have any use for.
 *
 * ## Where they run, and where they cannot
 *
 * `ramonda-css check` builds a program and the editor's plugin can ask its language service for
 * one. **Neither bundler adapter can**: `vite.ts` and `esbuild.ts` transform and never type-check,
 * so a typed rule is a check-and-editor rule and this file must never be imported by either.
 *
 * ## Nothing here is about this framework
 *
 * The subject is a declaration whose type is a `CssBlock`, in whatever declares it — a class
 * property, a parameter's property signature, a destructured binding. Measured on plain functions
 * with no class and no decorator, the answers are identical. What is needed is a program, the two
 * helper names the virtual file writes, and the identity of `CssBlock`; all three belong to this
 * package, and what renders the elements is not asked about.
 */

/**
 * The ids these rules use, for a consumer that has to tell them from a rule in `rules/`.
 *
 * `inOrder` drops a `TS2353` at the same character as any rule of ours, because a rule and the
 * compiler saying the same thing twice is the fault that filter exists for. Neither rule here ever
 * repeats the compiler — they answer a question it cannot ask — so a collision is two different
 * faults on one character, and dropping one hides a real type error. Measured on a wrapper that
 * takes a block and passes one on.
 */
export const TYPED_RULES = [
  "style-prop-never-used",
  "style-prop-overridden",
  "registered-never-set",
  "blocks-joined-not-merged",
  "state-is-a-tuple",
  "allow-list-is-an-interface",
  "narrower-after-a-whole-shorthand",
  "allow-list-not-css",
  "token-set-against-its-declaration",
  "unknown-custom-property",
  "cast-to-a-block",
] as const;

/** A finding about a file, at an offset in the AUTHOR's own text. */
export interface TypedFinding {
  readonly rule: (typeof TYPED_RULES)[number];
  readonly file: string;
  /** An offset in the author's file — already mapped home. */
  readonly at: number;
  readonly length: number;
  readonly message: string;
}

/**
 * Both rules over ONE file, with every position already mapped to the author's own text.
 *
 * Per file rather than per program, because the editor asks about the file somebody is looking at
 * and answering for a whole project on each keystroke would be work nobody asked for. It is also
 * sound rather than merely cheap: a rule's subject and its answer are always in one file — a slot's
 * scope is the class or function that declares it, and a spread and the declaration below it are
 * one block.
 *
 * A file with no overlay is the author's text as it stands, so an offset is where it already is. A
 * file WITH one holds a block, and everything after that block has moved — so the offset is asked
 * of {@link VirtualFile.homeOf}, and a position that maps nowhere is scaffolding this compiler
 * wrote and is dropped rather than shown.
 */
export function typedFindingsFor(
  checker: ts.TypeChecker,
  file: ts.SourceFile,
  overlay: { virtual: VirtualFile } | undefined,
  config?: Config,
): TypedFinding[] {
  if (file.isDeclarationFile) return [];
  const findings: TypedFinding[] = [];

  const reportAt = (start: number, length: number, what: Omit<TypedFinding, "file" | "at" | "length">): void => {
    const at = overlay === undefined ? start : overlay.virtual.homeOf(start);
    if (at === undefined) return;
    findings.push({ ...what, file: file.fileName, at, length });
  };
  const report = (node: ts.Node, what: Omit<TypedFinding, "file" | "at" | "length">): void =>
    reportAt(node.getStart(file), node.getWidth(file), what);

  const helpers = overlay?.virtual.helpers;
  if (helpers !== undefined) overriddenBelow(checker, file, helpers, report);
  // A component may hand its prop straight on without a block of its own, so this one runs on every
  // file — and a file with no overlay has no helper to find, which is what the empty names are for.
  neverUsed(checker, file, helpers ?? { block: "", from: "", hole: "" }, report);
  // Joining is a question about two VALUES and needs no block in this file: the blocks can both have
  // come from somewhere else, which is the shape it is worth reporting.
  joinedNotMerged(checker, file, report);
  // And this one is about a TYPE, so it needs no block in the file either — an allow-list is often
  // declared beside the component and used by callers somewhere else entirely.
  stateIsATuple(checker, file, report);
  // The one rule here that REPLACES the compiler rather than answering past it — see its docstring,
  // and `inOrder` in `check.ts` for where the `TS2344` it stands in for is dropped.
  allowListIsAnInterface(checker, file, report);
  // The compiler asks this inside ONE block; across blocks the spread is a value, and only a
  // program can follow it to the block it names.
  wholeAcrossBlocks(checker, file, helpers, report);
  allowListNotCss(checker, file, report);
  // A cast is written anywhere a value is, and needs no block in the file to be one.
  castToABlock(checker, file, helpers?.block, report);
  // The `style` attribute's half of what a block and a stylesheet are asked — see `declaredSet.ts`.
  if (config !== undefined) styleSetsADeclared(file, config, reportAt);
  if (config?.unknownCustomProperties === false || config?.unknownCustomProperties === "same-block") {
    styleMakesOneUp(file, config, reportAt);
  }

  return findings;
}

/** Every file in a program — what the CLI check asks for, one file at a time. */
export function typedFindings(
  program: ts.Program,
  overlays: ReadonlyMap<string, { virtual: VirtualFile; source: string }>,
  configFor?: (fileName: string) => Config | undefined,
): TypedFinding[] {
  const checker = program.getTypeChecker();
  return program
    .getSourceFiles()
    .flatMap((file) => typedFindingsFor(checker, file, overlays.get(file.fileName), configFor?.(file.fileName)));
}

/** Asked by `ramonda-css check` on its own, across the whole program — see its docstring. */
export { registeredNeverSet } from "./registered";
