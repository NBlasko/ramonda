import ts from "typescript";
import { conflict, covers } from "./flatten";
import { AT_RULE_LINKS, NOT_IN_A_RULE, PROPERTIES, SHORTHANDS } from "./keywords.generated";
import { readBlock } from "./read";
import { checkBlock } from "./rules";
import { findBlocks } from "./scan";
import { IMPORTANT, splitOf } from "./split";
import type { RegisteredSite } from "./variables";
import type { VirtualFile } from "./virtual";

/**
 * The rules that need a `ts.Program`, which is what separates them from every rule in `rules.ts`.
 *
 * ## Why they cannot live beside the others
 *
 * A rule in `rules.ts` reads a parsed `Block` and nothing else — no value to follow, no declaration
 * to resolve. Every rule here asks what a CALLER was promised, and the promise is written in a
 * type. So they need the checker, and putting them in `rules.ts` would make every rule pay for a
 * program that almost none of them have any use for.
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
 * The ids these rules use, for a consumer that has to tell them from a rule in `rules.ts`.
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

/** The names the virtual file gives its helpers, which is how a block is recognised in the AST. */
interface Helpers {
  readonly block: string;
  readonly from: string;
  readonly hole: string;
  readonly cond?: string;
  readonly vars?: string;
}

/**
 * The brand a compiled block carries, as TypeScript spells a `unique symbol` member.
 *
 * `properties.ts` declares `[COMPILED]: true` on `CssBlock`, and a member keyed by a unique symbol
 * is escaped to `__@<name>@<id>`. That is the block's IDENTITY, and asking for it is the only way
 * to tell one from a look-alike: measured, a project declaring its own
 * `type CssBlock = { className: string }` was reported by these rules, because they asked for the
 * NAME — and the extension opens this plugin on every project an editor has.
 *
 * Keying on the brand is also what makes an import alias and a generated module work: neither
 * changes the members, and `css-system/index.ts` re-exports the very same interface.
 */
const BRAND = "__@COMPILED@";

/** Where the allow-list is written down — see {@link allowedBy}. */
const ALLOWS = "__@ALLOWS@";

/** Is this the compiled-block type? */
function isBlock(checker: ts.TypeChecker, type: ts.Type): boolean {
  void checker;
  return branded(type) !== undefined;
}

/** The branded constituent of a type, which a union may hold beside `undefined`. */
function branded(type: ts.Type): ts.Type | undefined {
  for (const one of type.isUnion() ? type.types : [type]) {
    if (one.getProperties().some((each) => (each.escapedName as string).startsWith(BRAND))) return one;
  }
  return undefined;
}

/**
 * The allow-list a block type carries, or nothing when it carries the default.
 *
 * **Told apart by INDEX SIGNATURES rather than by a name or a count.** `CssBlockShape` has three —
 * one each for a nested rule, an at-rule and a dashed name — and a narrowed list is a plain object
 * type with none. Measured: 828 properties and 3 index infos against 1 and 0. A project's own
 * generated shape reads as the default too, which a name comparison would have got wrong the day
 * somebody renamed theirs.
 */
function allowedBy(checker: ts.TypeChecker, type: ts.Type): readonly string[] | undefined {
  const block = branded(type);
  if (block === undefined) return undefined;

  /**
   * Read off the `[ALLOWS]` MEMBER rather than off a type argument.
   *
   * `CssBlock` is `string & { [ALLOWS]: A }` now, which is a type alias of an intersection and not a
   * type REFERENCE — so `getTypeArguments` answers with nothing, and a slot that narrowed anything
   * silently stopped being read. The member is where the list is written down and is what the
   * phantom is for; asking it directly works whichever shape the type is declared in.
   */
  const carries = block.getProperties().find((each) => (each.escapedName as string).startsWith(ALLOWS));
  if (carries === undefined) return undefined;

  const argument = checker.getTypeOfSymbol(carries);
  if (checker.getIndexInfosOfType(argument).length > 0) return undefined;
  return argument.getProperties().map((each) => each.getName());
}

/**
 * Every DECLARATION an expression can reach, one hop at a time through what a name was declared as.
 *
 * **Declarations rather than symbols, and that is not a style choice.** A component's props reach it
 * through `Readonly<P>`, and a homomorphic mapped type synthesises a NEW symbol per property — so
 * `this.props.css` and the `css` in the type it came from are two symbols for one thing. Measured
 * on the real shape: identical symbol 0 times, shares a declaration 1. Comparing symbols reported
 * every style prop on every real component in this repository while the fixtures, which declared
 * their props inline, all passed.
 */
function reaches(checker: ts.TypeChecker, node: ts.Node, out: Set<ts.Node>, seen = new Set<ts.Node>()): void {
  if (seen.has(node)) return;
  seen.add(node);

  const visit = (one: ts.Node): void => {
    if (ts.isIdentifier(one) || ts.isPropertyAccessExpression(one)) {
      const name = ts.isPropertyAccessExpression(one) ? one.name : one;
      const symbol = checker.getSymbolAtLocation(name);
      if (symbol !== undefined) {
        for (const declaration of symbol.getDeclarations() ?? []) {
          out.add(declaration);
          if (ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined) {
            reaches(checker, declaration.initializer, out, seen);
          }
          if (
            (ts.isMethodDeclaration(declaration) || ts.isGetAccessorDeclaration(declaration)) &&
            declaration.body !== undefined
          ) {
            reaches(checker, declaration.body, out, seen);
          }
          /**
           * A destructured binding and the property it came FROM are two declarations of one
           * thing, and a RENAME is what makes that visible: `const { css: mine } = props` puts the
           * prop under a name the grouping by name can never match. Measured — it was one of three
           * shapes reported while being used perfectly well.
           */
          if (ts.isBindingElement(declaration)) {
            /**
             * The thing destructured, which is NOT always the declaration holding the pattern.
             * `function C({ css }: { css?: CssBlock })` is a parameter and its type is the props;
             * `const { css: mine } = props` is a variable declaration, and asking IT gives `any`
             * with no properties at all — measured, which is why the initialiser is preferred.
             */
            const holder = declaration.parent.parent;
            const source =
              ts.isVariableDeclaration(holder) && holder.initializer !== undefined ? holder.initializer : holder;
            const from = checker.getTypeAtLocation(source);
            const key = declaration.propertyName ?? declaration.name;
            const property = ts.isIdentifier(key) || ts.isStringLiteral(key) ? from.getProperty(key.text) : undefined;
            for (const one of property?.getDeclarations() ?? []) out.add(one);
          }
        }
      }
    }
    ts.forEachChild(one, visit);
  };

  ts.forEachChild(node, visit);
  visit(node);
}

/** The container a declaration belongs to — a class or a function. Pure TypeScript, no framework. */
function scopeOf(node: ts.Node): ts.Node {
  let found: ts.Node = node;
  while (
    found.parent !== undefined &&
    !ts.isClassDeclaration(found) &&
    !ts.isClassExpression(found) &&
    !ts.isFunctionDeclaration(found) &&
    !ts.isFunctionExpression(found) &&
    !ts.isArrowFunction(found) &&
    !ts.isMethodDeclaration(found)
  ) {
    found = found.parent;
  }
  return found;
}

/** Is this call one of the virtual file's helpers? */
function calls(node: ts.Node, name: string): node is ts.CallExpression {
  return ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name;
}

/**
 * **Rule 1 — a style prop nobody uses.**
 *
 * A component takes a block through a prop, a caller sends one, and the child never puts it on an
 * element. Nothing fails: the styles simply do not arrive, which is the quiet way a component and
 * its caller come apart.
 *
 * ## It walks BACKWARD, from the consumers
 *
 * The obvious pass — from the declaration out to its references — was written first and reported a
 * prop that IS used: `const mine = props.sx; ...{mine}` reaches a block through one local, and a
 * reference walk sees an assignment rather than a spread. So the pass runs the other way, from
 * every helper call back through what each name was declared as, and the set it builds is *what was
 * consumed* rather than *where this went*.
 *
 * ## Its one honest limit
 *
 * A prop consumed inside a method nobody calls passes quietly. That is reachability, which is a
 * different tool; this answers *never consumed*, not *consumed only where nothing runs*.
 */
function neverUsed(
  checker: ts.TypeChecker,
  file: ts.SourceFile,
  helpers: Helpers,
  report: (node: ts.Node, finding: Omit<TypedFinding, "file" | "at" | "length">) => void,
): void {
  /** Every declaration in the file whose type is a block, whatever kind of thing declares it. */
  const slots: { name: ts.Node; symbol: ts.Symbol; scope: ts.Node }[] = [];
  const collect = (node: ts.Node): void => {
    /**
     * A subject is a PROP, not every binding that happens to hold a block.
     *
     * A binding element destructuring a PARAMETER is a prop written the short way; one
     * destructuring a variable — `const { css: mine } = props` — is a local, and an unused local is
     * TypeScript's own `noUnusedLocals` rather than this rule's business. Measured: counting it
     * reported that one shape twice, once for the prop and once for the local standing for it.
     */

    const destructuresAProp = ts.isBindingElement(node) && !ts.isVariableDeclaration(node.parent.parent);
    const named =
      ts.isPropertySignature(node) || ts.isPropertyDeclaration(node) || destructuresAProp
        ? (node as ts.PropertySignature | ts.PropertyDeclaration | ts.BindingElement).name
        : undefined;
    if (named !== undefined && isBlock(checker, checker.getTypeAtLocation(node))) {
      const symbol = checker.getSymbolAtLocation(named);
      const scope = scopeOf(node);
      /**
       * **A scope with no BODY can never consume anything.** `declare function Inner(p: { css?:
       * CssBlock })` states a signature and holds no code, so nothing in it could put the prop on
       * an element — the rule would be reporting a fault the author cannot act on and cannot be
       * right about. Measured: a wrapper that DECLARES the component it renders was reported for
       * that component's prop rather than its own.
       *
       * Asked as *has a body* rather than *is ambient*, because that is the reason — and because
       * `NodeFlags.Ambient` is internal to TypeScript.
       */
      if (ts.isFunctionLike(scope) && (scope as { body?: ts.Node }).body === undefined) return;
      if (symbol !== undefined) slots.push({ name: named, symbol, scope });
    }
    ts.forEachChild(node, collect);
  };
  collect(file);
  if (slots.length === 0) return;

  /** One scope's consumed set, built once however many slots that scope declares. */
  const consumedIn = new Map<ts.Node, Set<ts.Node>>();
  const consumersOf = (scope: ts.Node): Set<ts.Node> => {
    const already = consumedIn.get(scope);
    if (already !== undefined) return already;

    const found = new Set<ts.Node>();
    const visit = (node: ts.Node): void => {
      if (calls(node, helpers.from) || calls(node, helpers.hole)) {
        for (const argument of node.arguments) reaches(checker, argument, found);
      }
      /**
       * Put straight on an element, or handed on to something that also takes a block. Both are
       * uses, and the first is what a component writes when it has no styles of its own.
       *
       * **`className` is matched by NAME, and it has to be.** A block is a string, so the attribute
       * it lands on is declared `string` — there is no block type in that position for a contextual
       * match to find. It used to be `css`, whose own type was a structural shape this compiler may
       * not import, so the answer was the same and the name was the other one.
       *
       * **Measured when `css` went: every component that forwards styles was reported as never
       * using its prop** — `<div className={props.css}>` is the ordinary shape, and it is the one
       * this rule exists to leave alone. A false report on the ordinary case is the one failure a
       * checker does not survive.
       *
       * `css` is kept beside it because a COMPONENT may still call its own prop that, and handing a
       * block to one is a use like any other — that half is a contextual match below, but a wrapper
       * on another JSX library can declare `css` on an intrinsic element too.
       *
       * Forwarding is matched by the CONTEXTUAL type instead, so it is the receiving prop's own
       * declaration that decides. Whether the two allow-lists AGREE is a separate question.
       */
      if (ts.isJsxAttribute(node) && node.initializer !== undefined) {
        const value = ts.isJsxExpression(node.initializer) ? node.initializer.expression : undefined;
        const name = ts.isIdentifier(node.name) ? node.name.text : node.name.getText();
        if (value !== undefined && (name === "className" || name === "css")) reaches(checker, value, found);
      }
      /**
       * Anything whose CONTEXTUAL type is a block has been handed somewhere that takes one, which
       * is a use however it was written — a JSX attribute, a property in an object, an argument to
       * an ordinary function. Asking the position's KIND instead missed the third, measured: a
       * component that hands its prop to a helper was reported while using it perfectly well.
       */
      if (ts.isExpression(node)) {
        const wanted = checker.getContextualType(node);
        if (wanted !== undefined && isBlock(checker, wanted)) reaches(checker, node, found);
      }
      ts.forEachChild(node, visit);
    };
    visit(scope);
    consumedIn.set(scope, found);
    return found;
  };

  /**
   * **One subject per NAME in a scope, not one per declaration.**
   *
   * `function Card({ sx }: { sx?: CssBlock })` declares the prop twice — a `BindingElement` and the
   * `PropertySignature` it destructures — and they are different symbols. Measured: asking about
   * each separately reported the prop TWICE, and linking them through the checker did not work,
   * because `getPropertySymbolOfDestructuringAssignment` is about a destructuring assignment and
   * not about a parameter's binding pattern.
   *
   * Grouping answers it without the checker: two declarations of one name in one scope are one
   * thing, consumed if EITHER symbol was, and reported at whichever came first — which is the
   * binding, the spelling the author actually reads.
   */
  const byName = new Map<string, typeof slots>();
  for (const slot of slots) {
    const key = `${slot.scope.pos}|${slot.name.getText()}`;
    const already = byName.get(key);
    if (already === undefined) byName.set(key, [slot]);
    else already.push(slot);
  }

  for (const group of byName.values()) {
    const slot = group[0];
    if (group.some((each) => (each.symbol.getDeclarations() ?? []).some((one) => consumersOf(each.scope).has(one))))
      continue;
    const name = slot.name.getText();
    report(slot.name, {
      rule: "style-prop-never-used",
      message:
        `\`${name}\` takes a style block and is never put on an element, so whatever a caller ` +
        `sends is\n        dropped without a word.\n\n        Spread it into a block — ` +
        `\`...{${name}};\` — or take the prop off.`,
    });
  }
}

/**
 * **Rule 2 — a declaration below the spread that clears what a caller may send.**
 *
 * `...{props.sx}; padding: 8px` where the prop allows `padding-left`: the shorthand clears the
 * longhand, exactly as CSS says, and the caller's value is gone. **The merge is not wrong here** —
 * the clear-list is emitted with its full context and does precisely this — so the fault is not a
 * broken override. It is a component that PROMISED a property in its allow-list and then took it
 * back, which is a question about the API and not about the stylesheet.
 *
 * Two fixes and both are right: move the spread below, or take the property out of the allow-list.
 *
 * ## Only a NARROWED prop is asked about
 *
 * A prop typed as a bare `CssBlock` promised nothing in particular, so nothing it promised can be
 * broken. Asking anyway would report every component that spreads a style prop and then writes a
 * shorthand, which is ordinary and correct code.
 *
 * ## The group is the ARRAY, which is what makes "below" answerable
 *
 * A block is one array and a nested rule is an array of its own, so a declaration is compared only
 * with the spread it actually sits after. `&:hover` is the same element and still its own group —
 * the same boundary `declaration-does-nothing` draws, for the same reason.
 */
function overriddenBelow(
  checker: ts.TypeChecker,
  file: ts.SourceFile,
  helpers: Helpers,
  report: (node: ts.Node, finding: Omit<TypedFinding, "file" | "at" | "length">) => void,
): void {
  const visit = (node: ts.Node): void => {
    if (ts.isArrayLiteralExpression(node)) {
      /**
       * One pass in source order, carrying what the spreads SO FAR have promised.
       *
       * Written the other way round first — every spread, then everything after it — and a block
       * with two spreads reported one declaration twice, at the same character. A declaration is
       * one fault whatever it clears, which is the same answer the rest of this package gives.
       */
      const promised = new Set<string>();

      for (const element of node.elements) {
        if (calls(element, helpers.from)) {
          for (const one of allowedBy(checker, checker.getTypeAtLocation(element.arguments[0])) ?? []) {
            promised.add(one);
          }
          continue;
        }
        if (promised.size === 0 || !ts.isObjectLiteralExpression(element)) continue;

        for (const property of element.properties) {
          if (!ts.isPropertyAssignment(property)) continue;
          const written = ts.isStringLiteral(property.name) ? property.name.text : property.name.getText();
          // A nested rule is its own group, so it is not "below" anything out here — and a spread
          // may not stand inside one anyway, which `spread-out-of-place` is what says so.
          if (written.startsWith("&") || written.startsWith("@")) continue;

          const cleared = [...promised].filter(
            (one) => covers(written, one) || (written === one && conflict(one, one)),
          );
          if (cleared.length === 0) continue;

          report(property.name, {
            rule: "style-prop-overridden",
            message:
              `\`${written}\` is written below the spread and clears \`${cleared.join("`, `")}\`, ` +
              `which this\n        component's own type says a caller may send — so what they send ` +
              `is thrown away.\n\n        Move the spread below this declaration, or take ` +
              `\`${cleared[0]}\` out of the prop's type.`,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
}

/**
 * Both rules over a whole program, with every position already mapped to the author's own file.
 *
 * A file with no overlay is the author's text as it stands, so an offset is where it already is.
 * A file WITH one holds a block, and everything after that block has moved — so the offset is asked
 * of {@link VirtualFile.homeOf}, and a position that maps nowhere is scaffolding this compiler
 * wrote and is dropped rather than shown.
 */
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
): TypedFinding[] {
  if (file.isDeclarationFile) return [];
  const findings: TypedFinding[] = [];

  const report = (node: ts.Node, what: Omit<TypedFinding, "file" | "at" | "length">): void => {
    const start = node.getStart(file);
    const at = overlay === undefined ? start : overlay.virtual.homeOf(start);
    if (at === undefined) return;
    findings.push({ ...what, file: file.fileName, at, length: node.getWidth(file) });
  };

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

  return findings;
}

/** Every file in a program — what the CLI check asks for, one file at a time. */
export function typedFindings(
  program: ts.Program,
  overlays: ReadonlyMap<string, { virtual: VirtualFile; source: string }>,
): TypedFinding[] {
  const checker = program.getTypeChecker();
  return program.getSourceFiles().flatMap((file) => typedFindingsFor(checker, file, overlays.get(file.fileName)));
}

/**
 * A registered property that every block READS and nothing SETS.
 *
 * ## What the fault is
 *
 * `@@property` requires an `initial-value` for every syntax but `*`, so a name nothing sets still
 * resolves — every element gets the initial, the page renders, and nothing anywhere says the value
 * the author meant to vary never arrives. That is the same silence the style prop's two rules exist
 * for, from the other end: there the value was handed over and never consumed, here it is consumed
 * and never handed over.
 *
 * It matters more now than it did. With the hole gone, `@@property` is how a value that changes at
 * run time reaches CSS at all — so a forgotten setter is not an unusual mistake, it is THE mistake
 * this door makes possible.
 *
 * ## What counts as setting it, and why the bar is so low
 *
 * Two things: a block that declares the name, which the CSS half already knows, and **any reference
 * to the binding in TypeScript at all**. The second is deliberately not narrowed to
 * `style={{ [angle]: v }}` or to `toStyle`: the binding is a string, so it reaches a setter through
 * any expression a person can write — an array, a helper, a prop, a re-export. Narrowing would have
 * to follow all of them, and the one it missed would be a false report on working code.
 *
 * So what is reported is the case where the name is written in exactly one place — its own
 * declaration — and read from blocks. Nothing else in the program mentions it. There is no
 * expression that could set it, so the report cannot be wrong about that.
 *
 * ## The one shape it is wrong about
 *
 * A library that EXPORTS a registered property for its consumers to set. The program is the
 * library, the consumers are not in it, and `export const accent = @@property( … )` is a reference
 * to nothing this can see. It is still reported, because within one project that same shape — a
 * theme module everything reads and nothing sets — is the fault itself, and telling the two apart
 * would mean guessing which of them the author is. The escape is the ordinary one: a
 * `ramonda-css-ignore` on the declaration, or the rule turned off in `ramonda.css.ts`.
 */
export function registeredNeverSet(
  program: ts.Program,
  overlays: ReadonlyMap<string, { virtual: VirtualFile; source: string }>,
  candidates: readonly { readonly file: string; readonly site: RegisteredSite }[],
): TypedFinding[] {
  if (candidates.length === 0) return [];

  const checker = program.getTypeChecker();

  /**
   * Each candidate's own symbol, found in the file that declares it.
   *
   * The virtual file rewrote the block into `__property({ … })`, so the DECLARATION is an ordinary
   * variable declaration with the author's own name on it — which is the one part of the site this
   * compiler did not touch, and so the one part a symbol can be asked for.
   */
  const wanted = new Map<ts.Symbol, { file: string; site: RegisteredSite }>();
  for (const candidate of candidates) {
    const file = program.getSourceFile(candidate.file);
    if (file === undefined) continue;
    const declared = declarationOf(file, candidate.site.binding);
    if (declared === undefined) continue;
    const symbol = checker.getSymbolAtLocation(declared);
    if (symbol !== undefined) wanted.set(symbol, candidate);
  }
  if (wanted.size === 0) return [];

  /**
   * One walk over the program, not one per candidate.
   *
   * Every identifier is resolved once and struck off; what is left named nothing but itself. An
   * import is followed to what it imports — `getAliasedSymbol` — because `import { accent }` and
   * the `const accent` it names are the same property and a reference through either is a set.
   */
  for (const file of program.getSourceFiles()) {
    if (file.isDeclarationFile || wanted.size === 0) continue;

    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node)) {
        const found = checker.getSymbolAtLocation(node);
        const symbol =
          found !== undefined && (found.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(found) : found;
        // Its own declaration is not a reference to it — that is the site being reported.
        if (symbol !== undefined && wanted.has(symbol) && !isJustNaming(node)) wanted.delete(symbol);
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }

  const findings: TypedFinding[] = [];
  for (const { file, site } of wanted.values()) {
    // Already an offset in the AUTHOR's file: a registered site comes from the CSS walk, which
    // reads the source as written. Nothing to map home.
    void overlays;
    findings.push({
      rule: "registered-never-set",
      file,
      at: site.at,
      length: site.length,
      message:
        `\`${site.binding}\` is read by a block and set by nothing, so every element gets its ` +
        `\`initial-value\`. Set it — \`style={{ [${site.binding}]: value }}\`, \`toStyle\`, or a ` +
        `block writing \`{${site.binding}}: <value>;\` — or write the value straight into the block if ` +
        `it never changes.`,
    });
  }
  return findings;
}

/**
 * Whether this identifier only NAMES the property, rather than using it.
 *
 * Four shapes name it and set nothing: its own `const`, the `import { angle }` that brings it in,
 * the `export { angle }` that passes it on, and a namespace import. The import one is not an edge
 * case — it is what every cross-module read looks like. A block writes `{angle}`, the compiler
 * resolves that to the generated name and writes the NAME into the CSS, so after the transform the
 * import is referenced by nothing and the bundler drops it. Counting it as a set would mean the rule
 * could never fire on a shared theme, which is the one place it is worth most.
 *
 * Measured: without this, a property declared in `theme.ts`, read by a block in `Card.tsx` and set
 * nowhere reported nothing at all.
 */
function isJustNaming(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (parent === undefined) return false;
  if (ts.isVariableDeclaration(parent)) return parent.name === node;
  if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent)) return true;
  return ts.isImportClause(parent) || ts.isNamespaceImport(parent);
}

/** The `const <name> =` this file declares at any depth, as the identifier a symbol can be had from. */
function declarationOf(file: ts.SourceFile, name: string): ts.Identifier | undefined {
  let found: ts.Identifier | undefined;
  const visit = (node: ts.Node): void => {
    if (found !== undefined) return;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
      found = node.name;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

/**
 * TWO BLOCKS JOINED INTO ONE STRING, where `mergeClassNames` was what the author meant.
 *
 * ## What is wrong with it
 *
 * A block is a string, so joining two of them produces a string — and a browser takes it. What it
 * does NOT do is merge: every class from both lands, and the STYLESHEET breaks the tie. Measured:
 *
 *     base = padding-left: 40px    card = padding: 8px
 *     mergeClassNames  panel r-cur-pointer r-disp-flex r-p-8px
 *     join             panel r-pl-40px r-cur-pointer r-disp-flex r-p-8px
 *
 * `r-pl-40px` should have been cleared by the `padding` written after it, which is what CSS's own
 * cascade does and what a merge is for. The page renders, with one declaration too many, and
 * nothing says so.
 *
 * ## Why it only became reachable now
 *
 * The brand refuses a joined string where a BLOCK is wanted — `` `${a} ${b}` `` cannot be spread
 * into another block, asserted six ways. But `className` takes a plain `string`, and a block is a
 * string, so the one place it matters is the one place the type cannot speak. That gap opened when
 * the `css` prop went.
 *
 * ## What it does NOT report
 *
 * One block and anything else. `` `lead ${card}` `` is the ordinary way to put a class of your own
 * beside a block, and it is CORRECT: a foreign class keys on itself, so merging it changes nothing —
 * measured, the two give the same string byte for byte. Reporting it would be a false report on the
 * shape the documentation teaches.
 */
function joinedNotMerged(
  checker: ts.TypeChecker,
  file: ts.SourceFile,
  report: (node: ts.Node, what: Omit<TypedFinding, "file" | "at" | "length">) => void,
): void {
  const isBlock = (node: ts.Node): boolean => branded(checker.getTypeAtLocation(node)) !== undefined;

  /**
   * Whether these are two DIFFERENT blocks, which is what the message claims and what makes it wrong
   * to join them.
   *
   * `` `${card} ${card}` `` is one block written twice: the classes duplicate, a duplicate class in a
   * class attribute does nothing, and no declaration overrides another. So the message — *a
   * declaration one of them meant to override survives* — would be false for it, and a message that
   * is false on the case it fires on is a false report however the rule is phrased.
   *
   * Told apart by SYMBOL, so two names for one binding are one block. An expression with no symbol —
   * a call, an index — is counted as its own, because nothing here can say two calls return the same
   * thing.
   */
  const distinct = (blocks: readonly ts.Expression[]): boolean => {
    const seen = new Set<ts.Symbol | ts.Expression>();
    for (const one of blocks) seen.add(checker.getSymbolAtLocation(one) ?? one);
    return seen.size > 1;
  };

  /**
   * A part NAMED `className`, which carries classes by convention and may carry a block.
   *
   * The type cannot tell: a block arriving as a `string` looks exactly like a foreign class name,
   * and reporting those is a false report on the shape the documentation teaches. The NAME can —
   * `className` is what classes travel under, and a component joining its caller's into a string
   * is the one place the merge never runs. Measured, that is also where the shorthand SPLIT changed
   * an answer: the caller's `padding` arrives as four longhand classes, the component's own
   * `padding-left` is a fifth, and which wins follows whichever stylesheet the bundler put first.
   */
  const carriesClasses = (node: ts.Expression): boolean => {
    if (ts.isPropertyAccessExpression(node)) return node.name.text === "className";
    if (ts.isIdentifier(node)) return node.text === "className";
    return false;
  };

  /** Two different blocks, or one block beside something classes travel under. */
  const joined = (blocks: readonly ts.Expression[], parts: readonly ts.Expression[]): boolean =>
    blocks.length > 0 && (distinct(blocks) || parts.some(carriesClasses));

  /** Every operand of a `+` chain, flattened — `a + " " + b` is three, not two. */
  const addends = (node: ts.Expression, into: ts.Expression[]): void => {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      addends(node.left, into);
      addends(node.right, into);
      return;
    }
    into.push(node);
  };

  const said = (node: ts.Node): void =>
    report(node, {
      rule: "blocks-joined-not-merged",
      message:
        `two style blocks joined into one string, which is not a merge — every class from both ` +
        `lands and the stylesheet breaks the tie, so a declaration one of them meant to override ` +
        `survives.\n\n        \`mergeClassNames(a, b)\` keeps one class per thing set. It gives ` +
        `the same ` +
        `string when nothing conflicts, and the right one when something does.`,
    });

  const visit = (node: ts.Node): void => {
    if (ts.isTemplateExpression(node)) {
      const parts = node.templateSpans.map((span) => span.expression);
      if (joined(parts.filter(isBlock), parts)) said(node);
    } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      /**
       * Only the OUTERMOST `+` of a chain, or `a + " " + b` would be reported twice — once for the
       * whole and once for the left half that is already a join.
       */
      const outer = !(ts.isBinaryExpression(node.parent) && node.parent.operatorToken.kind === ts.SyntaxKind.PlusToken);
      if (outer) {
        const parts: ts.Expression[] = [];
        addends(node, parts);
        if (joined(parts.filter(isBlock), parts)) said(node);
      }
    } else if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "join" &&
      ts.isArrayLiteralExpression(node.expression.expression)
    ) {
      // `[a, b].join(" ")`, which is the third way to write the same mistake.
      const parts = node.expression.expression.elements;
      if (joined(parts.filter(isBlock), parts)) said(node);
    }

    ts.forEachChild(node, visit);
  };

  visit(file);
}

/**
 * A state in an allow-list written as a one-element TUPLE — `[{ … }]` where `{ … }[]` was meant.
 *
 * ## What the fault is
 *
 * A nested rule compiles to one object literal PER DECLARATION, in an array:
 *
 *     @@( &:hover { color: blue; padding: 4px; } )   ->   {"&:hover":[{color},{padding}]}
 *
 * That shape is deliberate — TypeScript reports one excess property per object literal, so a
 * literal each is what makes every fault in a block come back at once instead of one per run.
 *
 * **A one-element tuple types element 0 and nothing else.** The first declaration inside the state
 * is checked against the allow-list and every declaration under it is accepted whatever it sets, so
 * a slot that reads as if it constrains a state constrains only its first line. Measured on this
 * repository's own playground, the same `float: left` inside a `&:hover` a `Chip` does not allow:
 *
 *     first declaration in the state    TS2353
 *     second                            silent
 *
 * `{ … }[]` gives every element the contextual type and reports all of them. It needs no change
 * anywhere else: the emitter already writes an array, and `CssBlockShape` already says
 * `CssBlockShape[]`.
 *
 * ## Why it needs a rule rather than a line in the documentation
 *
 * Because there is nothing else to meet. The tuple type-checks, the build passes, the slot half
 * works, and the half that does not is invisible from the call site — the caller writes a property
 * the component never offered and is told nothing. A page can say `{ … }[]`; this is what says it
 * to somebody who did not read the page.
 *
 * ## What it does NOT report, and why the bar is where it is
 *
 * A tuple of MORE than one element is left alone: every element then has a contextual type, so the
 * slot holds. It is an odd thing to write and it is not wrong.
 *
 * And a tuple is only this fault under a key that is really CSS — see `opensAState`, which is where
 * the weight is carried. The element is asked a second, weaker question (every member is a CSS
 * property, a custom one, or a state), and it is weak on purpose to state: measured, all 34 ordinary
 * field names tried are also CSS property names, so the element alone cannot tell an allow-list from
 * a point or a document type.
 *
 * Asking the checker for assignability to `CssBlockShape` was measured too, and is useless here: an
 * ordinary type with unrelated members IS assignable to it, because excess properties are only
 * checked on a fresh literal.
 *
 * ## The shape it cannot see
 *
 * A state whose type is written somewhere else — `"&:hover"?: Hover`, with `type Hover = [{ … }]`.
 * The type is resolved through the checker, so the tuple IS found; what is reported then is the
 * state, which is where the author acts, rather than the alias.
 */
function stateIsATuple(
  checker: ts.TypeChecker,
  file: ts.SourceFile,
  report: (node: ts.Node, what: Omit<TypedFinding, "file" | "at" | "length">) => void,
): void {
  const properties = new Set(PROPERTIES);

  /**
   * A key that opens a nested rule in a block shape — a selector, or an at-rule that may nest.
   *
   * **The key is where the tightening has to happen, and that was measured the hard way.** The first
   * version asked only whether the name began with `&` or `@` and leaned on the ELEMENT to tell a
   * block shape from anything else. The element cannot carry that weight: of 34 ordinary field names
   * checked — `x`, `y`, `content`, `order`, `filter`, `all`, `width`, `color` — **all 34 are CSS
   * properties**, so `{ x?: number; y?: number }` passes any test made of the property list. A
   * JSON-LD `"@type"` and a `"&ref"` of somebody's own were both reported.
   *
   * So the key is asked whether it is CSS. `&` has to continue as a selector does — CSS cannot
   * concatenate an identifier onto the parent, so `&ref` is not a selector at all — and `@` has to
   * name an at-rule that may sit inside a rule, which is the list `NOT_IN_A_RULE` is the complement
   * of.
   */
  const NESTS = new Set(Object.keys(AT_RULE_LINKS).map((one) => one.toLowerCase()));
  for (const one of NOT_IN_A_RULE) NESTS.delete(one.toLowerCase());
  /** What may follow `&`: a pseudo, a class, an attribute, an id, a combinator, or a descendant. */
  const AFTER_AMPERSAND = new Set([":", ".", "[", "#", ">", "+", "~", "&", "*", ",", " ", "\t"]);

  const opensAState = (name: string): boolean => {
    if (name.startsWith("&")) return name.length === 1 || AFTER_AMPERSAND.has(name[1]);
    if (!name.startsWith("@")) return false;
    const [word] = name.split(/[\s(]/, 1);
    return NESTS.has(word.toLowerCase());
  };

  /**
   * Whether this is the shape of a BLOCK rather than of any object that happens to sit in a tuple.
   *
   * Every member has to be something a declaration can set: a CSS property, a custom property, or a
   * state of its own. An empty type says nothing either way and is not enough to report on.
   */
  const isABlockShape = (type: ts.Type): boolean => {
    const members = type.getProperties();
    if (members.length === 0) return false;
    return members.every((each) => {
      const name = each.getName();
      return properties.has(name) || name.startsWith("--") || opensAState(name);
    });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isPropertySignature(node) && node.type !== undefined) {
      const name = ts.isStringLiteral(node.name) || ts.isIdentifier(node.name) ? node.name.text : undefined;
      if (name !== undefined && opensAState(name)) {
        const type = checker.getTypeAtLocation(node.type);
        const elements = checker.isTupleType(type) ? checker.getTypeArguments(type as ts.TypeReference) : undefined;

        if (elements?.length === 1 && isABlockShape(elements[0])) {
          report(node.type, {
            rule: "state-is-a-tuple",
            message:
              `\`${name}\` is a LIST of declarations, and this is a one-element tuple — write ` +
              `\`{ … }[]\` rather than \`[{ … }]\`.\n\n        A tuple gives the FIRST declaration ` +
              `inside the state a type and accepts whatever the rest set, so this slot stops ` +
              `constraining the state after its first line.`,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(file, visit);
}

/**
 * An `interface` handed to `CssBlock` — a refusal whose message sends the author to the wrong place.
 *
 * ## What the fault is
 *
 * `CssBlock<A>` constrains `A` to `CssBlockShape`, which is built out of index signatures — one for
 * `&`-keys, one for `@`-keys, one for custom properties. **TypeScript gives an interface no implicit
 * index signature**, so an interface satisfies none of them however it is written. Measured, with
 * the correct array spelling and with no state at all, both refused; the identical `type` beside
 * them is clean.
 *
 * ## Why a rule, when the compiler already reports it
 *
 * Because what the compiler says is about a thing the author did not write:
 *
 *     TS2344: Type 'CardStyle' does not satisfy the constraint 'CssBlockShape'.
 *             Type 'CardStyle' is not assignable to type '{ [nested: `&${string}`]: CssBlockShape[] }'
 *
 * It names an index signature, it names `CssBlockShape`, and it never says `interface` — so the one
 * word that would fix it is the one word missing. An author reads that and goes looking INSIDE the
 * interface, where there is nothing to find.
 *
 * **So this replaces the compiler's word rather than joining it**, which no typed rule has had to do
 * before: every other one answers a question TypeScript cannot ask, and `inOrder` lets both speak at
 * one character for exactly that reason. This one says the same thing better, so `check.ts` drops
 * the `TS2344` where this fires. The rule is reported on the same node the compiler used, which is
 * what makes that drop a position match rather than a guess.
 *
 * ## What it does not report
 *
 * An interface anywhere else. Interfaces are ordinary; only one handed to `CssBlock` is this fault.
 */
function allowListIsAnInterface(
  checker: ts.TypeChecker,
  file: ts.SourceFile,
  report: (node: ts.Node, what: Omit<TypedFinding, "file" | "at" | "length">) => void,
): void {
  /**
   * Whether this name was declared with `interface`, asked of the DECLARATION rather than the type.
   *
   * A type alias of an object literal and an interface are the same type to almost every question a
   * checker can be asked — the difference here is a rule about declarations, so that is what is
   * read. A merged interface has several declarations and any one of them answers.
   */
  const isAnInterface = (type: ts.Type): boolean =>
    (type.getSymbol()?.getDeclarations() ?? []).some(ts.isInterfaceDeclaration);

  const visit = (node: ts.Node): void => {
    if (ts.isTypeReferenceNode(node) && node.typeArguments?.length === 1) {
      const [argument] = node.typeArguments;
      /**
       * The OUTER type is what says this is a block, and it is still a block here: a type argument
       * failing its constraint does not stop the reference being instantiated, so the brand is
       * readable exactly as it is everywhere else in this file.
       */
      if (
        branded(checker.getTypeAtLocation(node)) !== undefined &&
        isAnInterface(checker.getTypeAtLocation(argument))
      ) {
        report(argument, {
          rule: "allow-list-is-an-interface",
          message:
            `\`${argument.getText(file)}\` is an interface, and an allow-list has to be a \`type\`.\n\n` +
            `        TypeScript gives an interface no index signature of its own, so it can never ` +
            `match a block's shape — whatever is written inside it. Writing \`type ` +
            `${argument.getText(file)} = { … }\` instead changes nothing else.`,
        });
      }
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(file, visit);
}

/**
 * `narrower-after-a-whole-shorthand` across blocks — a spread, or `mergeClassNames(a, b)`.
 *
 * The compiler refuses a narrower whole shorthand after a wider one inside one block. A spread is a
 * VALUE to it, so a wider one arriving through `...{base}` was never seen, and the merge could only
 * warn in development. A program can follow the name to the block it was written as, and read what
 * that block sets the way the compiler reads its own — as the author wrote it, one declaration each.
 *
 * WHOLE is what the sheet does with it: a shorthand that does not split (`splitOf` refuses it). A
 * narrower one that splits is pieces in `p`, stronger than `v`, and is not the fault. Only the top
 * level of each block is compared: a nested rule is its own context, as in the compiler's rule, and
 * a spread may only stand at the top. A name the program cannot follow to a block — a prop, a
 * parameter — says nothing, rather than guessing.
 */
function wholeAcrossBlocks(
  checker: ts.TypeChecker,
  file: ts.SourceFile,
  helpers: Helpers | undefined,
  report: (node: ts.Node, finding: Omit<TypedFinding, "file" | "at" | "length">) => void,
): void {
  /** The block a name was written as — its array of declarations — or nothing. */
  const blockOf = (expression: ts.Expression): ts.ArrayLiteralExpression | undefined => {
    let node: ts.Expression = expression;
    while (ts.isParenthesizedExpression(node)) node = node.expression;
    if (!ts.isIdentifier(node)) return undefined;
    let symbol = checker.getSymbolAtLocation(node);
    if (symbol !== undefined && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    const declaration = symbol?.valueDeclaration;
    if (declaration === undefined || !ts.isVariableDeclaration(declaration)) return undefined;
    const initial = declaration.initializer;
    if (initial === undefined || !ts.isCallExpression(initial) || !isBlock(checker, checker.getTypeAtLocation(initial)))
      return undefined;
    const [array] = initial.arguments;
    return array !== undefined && ts.isArrayLiteralExpression(array) ? array : undefined;
  };

  const whole = (property: string, value: string) =>
    property !== "all" && SHORTHANDS[property] !== undefined && splitOf(property, value) === undefined;

  /**
   * A whole shorthand still standing, its importance — which keeps it in its own layer — and where
   * it came from: this block's own declarations, a spread, or a `mergeClassNames` argument. Only
   * one that came from ELSEWHERE is this rule's; two in one block are the compiler's own.
   */
  interface Standing {
    readonly property: string;
    readonly important: boolean;
    readonly from: number;
  }

  /**
   * Whether an expression is a `$` path — `__vars.border.thin` — by the name the virtual file bound
   * `$` to. A spread's block is usually in another file, which binds its own, hence the pattern.
   */
  const variable = (node: ts.Expression): boolean => {
    let root: ts.Expression = node;
    while (ts.isPropertyAccessExpression(root) || ts.isElementAccessExpression(root)) root = root.expression;
    return root !== node && ts.isIdentifier(root) && (root.text === helpers?.vars || /^_*__vars$/.test(root.text));
  };

  /**
   * A value as the SHEET gets it, as far as this rule asks: a `$` path is a `var()` there, alone or
   * as part of a value — `1px solid $.color.a` is written as a template. §17: reading only string
   * literals missed every shorthand a variable keeps whole. Anything else is not read.
   */
  const valueOf = (value: ts.Expression): string | undefined => {
    if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) return value.text;
    if (variable(value)) return "var(--a)";
    if (!ts.isTemplateExpression(value)) return undefined;
    let text = value.head.text;
    for (const span of value.templateSpans) {
      if (!variable(span.expression)) return undefined;
      text += `var(--a)${span.literal.text}`;
    }
    return text;
  };

  /** A group's declarations, as written: property, value and node, nested rules left out. */
  const declared = (element: ts.Expression): [string, string, ts.Node][] => {
    if (!ts.isObjectLiteralExpression(element)) return [];
    const out: [string, string, ts.Node][] = [];
    for (const property of element.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      // The name's OWN file: a spread's block is usually declared in another one.
      const written = ts.isStringLiteral(property.name) ? property.name.text : property.name.getText();
      if (written.startsWith("&") || written.startsWith("@")) continue;
      const value = valueOf(property.initializer);
      if (value !== undefined) out.push([written, value, property.name]);
    }
    return out;
  };

  /** Which helper a call in a block's array is — by name, since another file's block names its own. */
  const helper = (element: ts.Expression): "from" | "cond" | undefined => {
    if (!ts.isCallExpression(element) || !ts.isIdentifier(element.expression)) return undefined;
    const name = element.expression.text;
    if (name === helpers?.from || /^__from\d*$/.test(name)) return "from";
    if (name === helpers?.cond || /^__cond\d*$/.test(name)) return "cond";
    return undefined;
  };

  /**
   * One block's top level, in order, against what is standing — its spreads add, its declarations
   * are checked and then CLEAR what they cover, as the merge does: a block that sets `border` itself
   * after a spread has taken the spread's whole `border` away.
   *
   * A GUARDED group ends the walk. The virtual file writes `if` as a marker followed by the group's
   * declarations with nothing where the group closes, so whether a later re-set is guarded cannot
   * be read here — and a rule that guesses reports correct code. The merge's development warning
   * still sees what is left. A `match`'s arms each set the family, so they clear like one
   * declaration. `path` stops a cycle and nothing else: a block spread twice counts twice, as its
   * classes land twice.
   */
  const walk = (
    array: ts.ArrayLiteralExpression,
    standing: Standing[],
    /** Where this block's own declarations come from, and where what it spreads comes from. */
    origin: { readonly own: number; readonly spread: number },
    found: (node: ts.Node, narrower: string, covering: Standing) => void,
    path: Set<ts.Node>,
  ): void => {
    if (path.has(array)) return;
    path.add(array);
    for (const element of array.elements) {
      const kind = helper(element);
      if (kind === "cond") break;
      if (kind === "from") {
        const inner = blockOf((element as ts.CallExpression).arguments[0]);
        if (inner !== undefined) walk(inner, standing, { own: origin.spread, spread: origin.spread }, () => {}, path);
        continue;
      }
      for (const [property, value, where] of declared(element)) {
        const important = IMPORTANT.test(value);
        const isWhole = whole(property, value);
        if (isWhole) {
          const covering = standing.find((one) => one.important === important && covers(one.property, property));
          if (covering !== undefined) found(where, property, covering);
        }
        for (let at = standing.length - 1; at >= 0; at--) {
          const one = standing[at];
          if (one.important === important && (one.property === property || covers(property, one.property)))
            standing.splice(at, 1);
        }
        if (isWhole) standing.push({ property, important, from: origin.own });
      }
    }
    path.delete(array);
  };

  const said = (node: ts.Node, narrower: string, wider: string): void =>
    report(node, {
      rule: "narrower-after-a-whole-shorthand",
      message:
        `\`${narrower}\` comes after \`${wider}\`, and both reach the stylesheet whole, so no order keeps ` +
        `\`${narrower}\` winning on every page. Set its longhands instead.`,
    });

  const visit = (node: ts.Node): void => {
    // A block of THIS file: what its spreads leave standing, against what it writes below them.
    if (helpers !== undefined && calls(node, helpers.block)) {
      const [array] = node.arguments;
      if (
        array !== undefined &&
        ts.isArrayLiteralExpression(array) &&
        array.elements.some((one) => helper(one) === "from")
      )
        walk(
          array,
          [],
          { own: 0, spread: 1 },
          (where, narrower, covering) => {
            if (covering.from === 1) said(where, narrower, covering.property);
          },
          new Set(),
        );
    }
    // And a merge at a call site, argument by argument: told at the argument, and only for a wider
    // shorthand an EARLIER argument left — one inside the argument's own block is its file's.
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      let symbol = checker.getSymbolAtLocation(node.expression);
      if (symbol !== undefined && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
      // The package's own `mergeClassNames`, by where it is DECLARED — an app's function of that
      // name is not asked about.
      const origin = symbol?.declarations?.[0]?.getSourceFile().fileName ?? "";
      if (symbol?.name === "mergeClassNames" && /[\\/](@ramonda[\\/]css|packages[\\/]css)[\\/]/.test(origin)) {
        const standing: Standing[] = [];
        node.arguments.forEach((argument, index) => {
          const block = blockOf(argument);
          if (block === undefined) return;
          let told = false;
          walk(
            block,
            standing,
            { own: index, spread: index },
            (_where, narrower, covering) => {
              if (!told && covering.from < index) said(argument, narrower, covering.property);
              told = true;
            },
            new Set(),
          );
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
}

/** The rules that judge a VALUE — what an allow-list's literal is asked, and nothing structural. */
const VALUE_RULES = new Set([
  "unknown-value",
  "unknown-unit",
  "too-many-values",
  "word-out-of-its-longhand",
  "value-differs-across-engines",
]);

/**
 * The compiler's own verdict on one declaration, as the findings of the value rules — asked by
 * compiling it, so an allow-list's value is refused exactly when it would be refused in a block.
 */
function valueFaults(property: string, value: string): string[] {
  const key = `${property}\u0000${value}`;
  const known = FAULTS.get(key);
  if (known !== undefined) return known;
  const found = compiledFaults(property, value);
  FAULTS.set(key, found);
  return found;
}

/**
 * Each pair's verdict, once per process: an allow-list type is referenced wherever the slot is, and
 * every reference asked again compiled the same declaration again. It is a pure function of the
 * pair, so there is nothing to invalidate.
 */
const FAULTS = new Map<string, string[]>();

function compiledFaults(property: string, value: string): string[] {
  /**
   * A literal the probe cannot hold as ONE value is not judged: a `;`, a brace or an unbalanced
   * parenthesis would end the declaration early or open a hole, and the verdict would be about some
   * other text. Nor is a failure to read or check it a verdict — saying "not CSS" for a compiler
   * fault would send the author after a value that may be right.
   */
  if (/[;{}]/.test(value) || value.split("(").length !== value.split(")").length) return [];
  const source = `const x = @@( ${property}: ${value}; );`;
  const [site] = findBlocks(source);
  if (site === undefined) return [];
  try {
    const read = readBlock(source, site.open, "allow-list.tsx", { tolerant: true });
    return checkBlock(read.block, {})
      .filter((one) => VALUE_RULES.has(one.rule))
      .map((one) => one.rule);
  } catch {
    return [];
  }
}

/**
 * §11 — an allow-list value that is not CSS.
 *
 * A component narrowing its slot to `"font-weight"?: "notexisting"` refused every caller, and said
 * nothing itself: the TYPE is well-formed, and the value only fails when somebody tries to send it.
 * Only the component's author can fix it, so it is reported at the value, where they wrote it.
 *
 * Only LITERAL types are asked — a string or a number. `Var<"color">`, `Token<…>` and `string` have
 * nothing to judge; measured in this repository, 5 of 12 allow-list entries are literals. A nested
 * state (`"&:hover"?: { … }[]`) is read the same way. Each declaration is reported once, however
 * many slots name its type.
 */
function allowListNotCss(
  checker: ts.TypeChecker,
  file: ts.SourceFile,
  report: (node: ts.Node, what: Omit<TypedFinding, "file" | "at" | "length">) => void,
): void {
  const said = new Set<ts.Node>();

  const judge = (shape: ts.Type, fallback: ts.Node): void => {
    for (const member of shape.getProperties()) {
      const name = member.getName();
      if (name.startsWith("--") || name.startsWith("@")) continue;
      const type = checker.getNonNullableType(checker.getTypeOfSymbol(member));
      if (name.startsWith("&")) {
        const element = checker.isArrayType(type) ? checker.getTypeArguments(type as ts.TypeReference)[0] : undefined;
        if (element !== undefined) judge(element, fallback);
        continue;
      }
      const declaration = member.getDeclarations()?.[0];
      const where = declaration !== undefined && declaration.getSourceFile() === file ? declaration : fallback;
      for (const one of type.isUnion() ? type.types : [type]) {
        if (!one.isStringLiteral() && !one.isNumberLiteral()) continue;
        const value = String(one.value);
        if (valueFaults(name, value).length === 0) continue;
        // Once per declaration: two bad values in one union are one line to fix.
        if (said.has(where)) continue;
        said.add(where);
        report(where, {
          rule: "allow-list-not-css",
          message:
            `\`${value}\` is not a value \`${name}\` takes in CSS, so every caller sending it is refused. ` +
            `Take it out of the allow-list, or write the value you meant.`,
        });
      }
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isTypeReferenceNode(node) && node.typeArguments?.length === 1) {
      const [argument] = node.typeArguments;
      if (branded(checker.getTypeAtLocation(node)) !== undefined) judge(checker.getTypeAtLocation(argument), argument);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(file, visit);
}
