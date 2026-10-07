import type { BlockItem, ValuePart, VariablePart } from "./ast";
import { MATCH, SPREAD, branchOf, holeIn } from "./read";
import { selectorOf } from "./flatten";
import { expressionFor, isIdentifier } from "./dollar";
import { collapse, propertyName } from "./normalise";
import type { Span } from "./read";
import { readBlock } from "./read";
import { NAMED_BLOCKS } from "./rules";
import { type BlockSite, afterShebang, findBlocks, mayHoldABlock } from "./scan";
import { type Imported, namedSites } from "./references";

/**
 * The virtual file: the author's file as valid TSX, and the way back from a diagnostic to the
 * character they typed.
 *
 * This is the whole of the claim the package rests on — **a syntax TypeScript cannot parse can
 * still be fully type-checked**, as long as we own the step that turns it into TypeScript. It is
 * the same three moves `vue-tsc` and `svelte-check` make: write a virtual file, hand it to `tsc`,
 * map each diagnostic home.
 *
 * ## Two things go in, and the second is what makes CSS type-safe at all
 *
 * - **Each hole's expression, in its real lexical scope.** The expression stays inside the same JSX,
 *   in the same method, on the same class — so `this`, the imports and the generics are all what the
 *   author sees. Nothing is lifted out.
 * - **Each block as an object literal.** An object literal is what gets excess-property checking, and
 *   excess-property checking is what produces TypeScript's own *did you mean* on a CSS property name.
 *   Any other shape — a call with strings, a tagged template — throws that away.
 *
 * ```
 *   <div css=@@( display: flex; border-left: 4px solid $(this.accent); )>
 *
 *   <div css={__block({ "display":"flex", "border-left":`4px solid ${this.accent}` })}>
 * ```
 *
 * ## Two kinds of mapping, because only some of the text is the author's own
 *
 * The expressions and everything outside a block are **copied**, byte for byte, so a diagnostic
 * inside one maps offset by offset. A property name, a value and a selector are **rewritten** —
 * quoted, escaped, whitespace folded — so anything landing in one maps to where it STARTS. That is
 * the position the reader needs anyway: a *did you mean* about `dsiplay` belongs on `dsiplay`.
 *
 * Anything that maps nowhere is scaffolding, and a caller drops it: `__block` itself, the
 * punctuation between declarations, the preamble. Those diagnostics are about the file we wrote,
 * not the one they did.
 *
 * ## Line for line, which is not free and is worth it
 *
 * A multi-line block written as ONE line would move every line after it up, and
 * `scripts/check-examples.mjs` reports a documented example's fault by LINE with no source map to
 * consult. So the preamble ends without a newline, and each item is preceded by the newlines the
 * author wrote before it — **every line is the same line, inside a block as well as outside**.
 * Newlines put after the block instead collapse every declaration onto its opening line, so a typo
 * on line 186 is reported on 185.
 *
 * ## Where a diagnostic lands, which depends on its kind
 *
 * Measured through a real `ts.Program`, and worth knowing before reading a position:
 *
 * | written | reported | lands on |
 * |---|---|---|
 * | `dsiplay: flex` | `TS2561`, *did you mean 'display'* | the property |
 * | `display: flexx` | `TS2820`, *did you mean "flex"* | the property |
 * | `padding: $(this.size)` | `TS2322`, `boolean` not assignable | the property |
 * | `color: $(missing)` | `TS2304`, cannot find name | the **expression** |
 *
 * TypeScript reports an object literal's assignability errors at the property assignment, whose
 * start is the key; an error about a name inside an expression is reported on the name. Both map
 * home correctly and neither is a fault to fix — but a caller printing a caret has to know that a
 * value error points at its declaration.
 */

export interface VirtualFileOptions {
  /** Where the block shape is imported from. Track C fills that module in; the shape is stable. */
  readonly properties?: string;
  /** The importing file's own path, for resolving a relative specifier — see {@link Imported}. */
  readonly filename?: string;
  /**
   * How to read a module a block imports a named site from.
   *
   * The same reader the build and the checker use, for the reason all of them share one: a reference
   * that resolves is TEXT and one that does not is a hole, and those are checked differently. A
   * virtual file that resolved less than the build would type-check an expression the build never
   * emits — and report a name the author was right to write.
   */
  readonly read?: Imported["read"];
  /**
   * Read a half-written block instead of refusing it — for an editor, which sees nothing else.
   *
   * Measured: `disp` and `&:hover { col }` both refuse in strict mode, and those are the two states
   * a person is in most while typing a property name. A refusal means no virtual file, which means
   * no completions exactly when they are wanted. See `ReadOptions.tolerant`.
   */
  readonly tolerant?: boolean;
}

export interface VirtualFile {
  /** Valid TSX. */
  readonly code: string;
  /**
   * The names this file gave the three helpers a consumer has to FIND again, by what each one is
   * for rather than by where it sits in a list.
   *
   * `bindings` is next to this and holds the same names, but it is a list in emit order — so a
   * consumer reading `bindings[2]` is one insertion away from silently asking about the wrong
   * helper. The typed rules ask which call is a spread and which is a hole, and that question has
   * names.
   */
  readonly helpers: {
    readonly block: string;
    readonly from: string;
    readonly hole: string;
    /** The guard's marker — `when $(on)` — which a typed rule reads as "what follows may not apply". */
    readonly cond?: string;
    /** What `$` is bound to — `__vars.border.thin` is a `var()` in the sheet. */
    readonly vars?: string;
  };
  /**
   * The names this file declared for itself — the block helper, composition's two, the hole's type,
   * and one per kind of named site the file holds.
   *
   * They are in scope for the whole file, so TypeScript offers them wherever it offers the author's
   * own bindings. A consumer showing completions has to take them out; nothing of the author's is
   * ever removed by doing so, because {@link binding} picks a name the source does not contain.
   */
  readonly bindings: readonly string[];
  /**
   * Where the generated prologue ends.
   *
   * A diagnostic before this and mapping NOWHERE is about the declaration this wrote — the helper,
   * and the type it is declared against. It is the one scaffolding a caller must not drop: if the
   * shape cannot be resolved, everything becomes `any`, nothing is checked, and a silent pass is the
   * worst answer a checker can give.
   *
   * The author's own leading comments are copied in front of the prologue, so they are before this
   * too — and they map, which is how a diagnostic about a bad `/// <reference … />` still lands on
   * the line the author wrote it. Mapping is what tells the two apart, not the offset alone.
   */
  readonly preamble: number;
  /**
   * The author offset a virtual offset came from, or `undefined` when it is scaffolding.
   *
   * A diagnostic whose start maps to `undefined` is about the file this wrote and must not be shown.
   */
  homeOf(offset: number): number | undefined;
  /**
   * Where the DECLARATION holding an author offset begins, in virtual coordinates.
   *
   * A caret inside a value or a selector maps into a string literal, and TypeScript has nothing to
   * say about a position inside one — measured, hover over `column;` and over `&:hover` both came
   * back empty. The declaration is what a reader was asking about anyway, so a question that lands
   * nowhere is asked again here.
   */
  declarationOf(offset: number): number | undefined;
  /**
   * The virtual offset for an author offset — the other direction, and the one an editor needs.
   *
   * A caret is in the author's file and every question about it has to be asked of the virtual one.
   * Measured on a plain object literal, which is what a block becomes: **inside** a half-typed key
   * gives the property names, **inside** a half-typed value gives the value union, and immediately
   * after a complete key gives nothing useful. So this lands inside the token rather than at its
   * edge, which is what makes completion work at all.
   */
  virtualOf(offset: number): number | undefined;
  /**
   * A virtual SPAN in the author's coordinates — start and length, not two lookups.
   *
   * **Two lookups do not work, and the failure is quiet.** A span over a rewritten run ends exactly
   * at that run's edge, where the next virtual text is punctuation this file invented — so the end
   * maps nowhere and the caller is left clamping to an empty span. Measured: a `dsiplay` diagnostic
   * highlighting nothing. The run knows how much of the author's text it stands for, so this asks it
   * rather than asking about two offsets that do not know about each other.
   *
   * A copied run maps both ends. A rewritten one has no interior correspondence, so the answer is
   * the whole of the author's text it stands for — which is the right HIGHLIGHT (a *did you mean*
   * about `dsiplay` underlines `dsiplay`, whatever quoting the virtual file needed) and is not
   * always a safe thing to OVERWRITE. See `replaces` in the plugin, which decides that separately.
   */
  spanOf(start: number, length: number): { start: number; length: number } | undefined;
}

/** One run of virtual text, and where it came from. */
interface Segment {
  /** Virtual offsets, half-open. */
  readonly from: number;
  readonly to: number;
  /** The author offset this run starts at. */
  readonly source: number;
  /**
   * How much of the AUTHOR's text this run stands for.
   *
   * For a copied run it is the same as the virtual length. For a rewritten one it is not — a
   * property name gains quotes, a value is folded — and the two are different questions. This is the
   * one an author-offset lookup asks: a caret past the end of the text a segment stands for belongs
   * to nothing yet, and treating it as belonging to the last segment before it is what made a caret
   * on a blank line map into the previous declaration's value. Measured: 0 completions where 551
   * were wanted.
   */
  readonly sourceLength: number;
  /**
   * Whether this run is the author's own bytes, so an offset inside it maps offset for offset.
   *
   * Recorded rather than INFERRED from `to - from === sourceLength`: a value is emitted quoted and
   * its whitespace folded, so the two lengths coincide exactly when folding drops two characters,
   * which is ordinary aligned CSS. Inferred, `border-left-style: sol id` had every span in it
   * shifted by one, and accepting `solid` produced `ssolidd`.
   *
   * One question, answered once by the code that knows: `copy` writes true and `derived` writes
   * false.
   */
  readonly copied: boolean;
}

/** `undefined` when the file holds no block — there is then nothing a virtual copy would add. */
export function virtualFile(source: string, options: VirtualFileOptions = {}): VirtualFile | undefined {
  if (!mayHoldABlock(source)) return undefined;
  const tolerant = options.tolerant === true;

  const sites = findBlocks(source);
  if (sites.length === 0) return undefined;

  const segments: Segment[] = [];
  /** How far the author's text has been accounted for. Set once the leading trivia is copied. */
  let cursor = 0;
  let code = "";

  /** Text this file invented. Nothing maps to it, so a diagnostic in it is dropped. */
  const write = (text: string): void => {
    code += text;
  };

  /**
   * How far the author's text has been accounted for, in LINES — see `keepLine`.
   *
   * At this scope rather than the site loop's because {@link copy} has to move it: copied text
   * carries the author's own newlines, and a `keepLine` that did not know they were already written
   * put them in a SECOND time. Measured: a hole whose expression spanned four lines made the virtual
   * file four lines longer than the author's, and `check-examples.mjs` maps a diagnostic home by
   * counting lines and has no source map to fall back on.
   */
  let lined = 0;

  /** The author's own bytes, so an offset inside maps offset for offset. */
  const copy = (start: number, end: number): void => {
    segments.push({
      from: code.length,
      to: code.length + (end - start),
      source: start,
      sourceLength: end - start,
      copied: true,
    });
    code += source.slice(start, end);
    lined = Math.max(lined, end);
  };

  /**
   * Their text, rewritten. Every offset inside maps to where it started, and `length` is how much of
   * the author's own text it stands for — see {@link Segment.sourceLength}.
   */
  const derived = (text: string, at: number | undefined, length = text.length): void => {
    if (at !== undefined) {
      segments.push({
        from: code.length,
        to: code.length + text.length,
        source: at,
        sourceLength: length,
        copied: false,
      });
    }
    code += text;
  };

  /**
   * The author's leading comments, copied BEFORE anything of ours is written.
   *
   * Two directives only work in a file's leading trivia, and a `declare` in front of them takes
   * both away — measured: `// @ts-nocheck` was ignored, so every error in a file the author had
   * switched off came back, and `/// <reference … />` was dropped, so the types it pulls in were
   * missing. Both are FALSE reports, which is the one failure a checker does not survive.
   *
   * Nothing moves: the `declare` goes at the start of the line the first statement was already on.
   */
  const top = afterLeadingTrivia(source);
  if (top > 0) copy(0, top);
  cursor = top;

  const block = binding(source, "__block");
  /** What a `match` becomes — see the declaration below for what it checks. */
  const lookup = binding(source, "__match");
  const from = JSON.stringify(options.properties ?? "@ramonda/css/properties");
  /**
   * A `declare`, not an `import` statement: an import would turn a file that is a script into a
   * module, which changes what the author's own code means. An import TYPE in a type position does
   * not.
   */
  /**
   * **Generic, and `A` may be inferred only from the RETURN position.** That is what lets a prop
   * narrow a block — `sx?: CssBlock<{ color?: Token<"color"> }>` — and it is the only one of three
   * shapes measured that puts the fault where the author can act on it:
   *
   *     inferring `A` from the argument      every declaration reported, including the right ones
   *     comparing the RESULT for its keys    one error on the call, naming a type nobody wrote
   *     `NoInfer`, the allow-list first      the value, the property, or inside the state
   *
   * `NoInfer` is why the peer floor is TypeScript 5.4. The pre-5.4 spelling
   * `[T][T extends unknown ? 0 : never]` was measured to behave identically and is what to reach
   * for if that floor ever has to come back down.
   *
   * With no contextual type — which is nearly every block ever written — `A` falls back to the
   * default and the parameter is the shape it always was. Asserted in `check.test.ts`, because a
   * slot that narrowed ordinary blocks would be a regression in every file of every project.
   */
  /**
   * **ONE helper, because every block is static.** A runtime value in a declaration is refused
   * everywhere — see `hole-not-allowed` — so there is nothing left for a prop to refuse and no flag
   * to carry.
   */
  /**
   * **A narrowed value takes the CSS-wide keywords too** — `inherit`, `initial`, `unset`, `revert`,
   * `revert-layer` — as `Keyword<K>` does for a closed list. They are what CSS itself provides, not
   * a value the project chose, so `{ gap?: "8px" }` accepting `gap: inherit` is the slot meaning
   * what it says. The user's decision, DESIGN.md §13.
   *
   * Only the keywords: another value, `!important` and a property outside the list are refused as
   * before. A state is an ARRAY of declarations and is opened, not widened, so its values take the
   * keywords as well.
   *
   * **A value that already takes `inherit` is handed back as it was**, and that is what keeps an
   * ordinary block untouched. Widening it unconditionally was measured to cost every block its
   * messages: `V | CssGlobal` is a new union, TypeScript prints it member by member, and `position:
   * statik` stopped naming `Keyword<…>` and listed twenty-one values instead.
   *
   * **`CssGlobal` is taken from the properties module, and guarded.** Named, a message reads
   * `'"8px" | "16px" | CssGlobal'`, the author's own list first. But a name the module does not
   * export is `any` here, not an error, and `any` silences every check in the file — so a module
   * without it gets the words instead.
   *
   * **`any` in the list is handed back as it is.** It answers yes to "is this an array", so opened
   * like a state, `width?: any` would refuse `width: 10px`.
   *
   * **No type is NAMED here.** In a file that is a script, a name the virtual file declares is
   * global, and a second script declaring it again is `TS2300` — measured, for a type alias and for
   * an interface alike. So the widening is written out level by level, `WIDENED_DEPTH` deep.
   */
  const global = `import(${from}).CssGlobal`;
  // A module without `CssGlobal` — one generated before it was exported — gets the words written out.
  const keywords = `(0 extends 1 & ${global} ? "inherit" | "initial" | "unset" | "revert" | "revert-layer" : ${global})`;
  /** One level of the widening, around `value`; a state opens into the next level, `depth` of them. */
  const widened = (value: string, depth: number): string =>
    depth === 0
      ? value
      : `(0 extends 1 & ${value} ? ${value} : [NonNullable<${value}>] extends [readonly (infer E${depth})[]] ? ` +
        `{ [K${depth} in keyof E${depth}]?: ${widened(`E${depth}[K${depth}]`, depth - 1)} }[] : ` +
        `"inherit" extends ${value} ? ${value} : ${value} | ${keywords})`;
  write(
    `declare function ${block}<A extends import(${from}).CssBlockShape = import(${from}).CssBlockShape>` +
      `(declarations: NoInfer<{ [P in keyof A]?: ${widened("A[P]", WIDENED_DEPTH)} }>[]): import(${from}).CssBlock<A>;`,
  );

  /**
   * Composition's two helpers, each its own ARRAY ELEMENT rather than something wrapping a group —
   * see the note in `items` for why.
   */
  /**
   * `$` — the project's tokens, bound under a name of ours so a block needs no import.
   *
   * Left to ordinary scope, a missing import is not met with a sentence anybody can act on.
   * Measured, TypeScript writes:
   *
   *     Cannot find name '$'. Do you need to install type definitions for jQuery?
   *
   * It names a library nothing here has anything to do with, and completion is dead beside it
   * because the name resolves to nothing.
   *
   * A block is this package's language, and `$` belongs to it the way `@@` does. So it is bound
   * here, from whichever property map applies, and an author who uses `$` for something else of
   * their own is untouched: `binding` picks a name their file does not hold.
   *
   * A `typeof import( … )` in a type position, for the same reason as the helpers above: an import
   * STATEMENT would turn a script into a module and change what the author's own code means.
   */
  const variables = binding(source, "__vars");
  /**
   * The fallback is written INLINE rather than imported, so nothing has to export a `$`.
   *
   * An export is an AUTO-IMPORT suggestion: typing `$` in ordinary TypeScript would offer `import {
   * $ } from "@ramonda/css/properties"`, a type that exists only to carry a sentence, beside the
   * real `$` from the project's own generated module.
   *
   * The conditional keeps both cases in one line: a generated module exports one `$group` per
   * group, and the groups are gathered back into one object here — `$color` as `__vars.color` — so
   * a block still needs no import; the shipped map exports none and the sentence stands in. The
   * sentence is a type rather than `never` for the reason measured in `properties.ts` — `never`
   * says *Property 'color' does not exist on type 'never'*, and this says what to do.
   */
  write(
    `declare var ${variables}: typeof import(${from}) extends infer M ? ({ [K in keyof M as K extends \`$\${infer G}\` ? G : never]: M[K] } extends infer V ? (keyof V extends never ? ` +
      `"Declare your tokens in ramonda.css.ts, then run \`ramonda-css codegen\`." : V) : never) : never;`,
  );

  const condition = binding(source, "__cond");
  const spread = binding(source, "__from");
  write(`declare function ${condition}<T>(condition: import(${from}).CssCondition<T>): never;`);
  write(`declare function ${spread}<T>(block: import(${from}).CssSpreadable<T>): never;`);

  /**
   * What a HOLE IN A VALUE is checked against.
   *
   * `types.ts` excludes `undefined` from a hole on purpose, measured against a real server render:
   * one that is `undefined` on the server and a value on the client is repaired silently, and the
   * other direction is reported as a divergence and **not** repaired. Two paths let it back in
   * anyway. `CssBlockShape` is a `Partial`, and optionality puts `| undefined` back on every
   * property — so `color: {maybe}` passed. And a value that is TEXT AND HOLES is written as a
   * TEMPLATE LITERAL, which accepts anything at all: measured, `border-left: {obj} solid red` with
   * an object passed, and so did `null`, and so did a function's `void`. That second half was
   * checked by nothing whatsoever.
   *
   * **A function rather than `satisfies`, and the reason is POSITION rather than taste.** Both
   * report the same faults; `satisfies` reports them better, naming the expression's own type where
   * this one falls back to the constraint. But TypeScript puts a `TS1360` on the `satisfies` clause
   * — text this file wrote — so `homeOf` maps it nowhere and `check.ts` drops it: measured, the
   * diagnostic existed and the author never saw it. An argument is the author's own bytes, so the
   * `TS2345` lands where they can act on it.
   *
   * The property's own check survives either way, which was the thing to protect: an object in a
   * `color` is still a `TS2322` about `color`, and `display: flexx` still gets its *did you mean*.
   */
  /**
   * `match $(subject) { key => value; … }`, as something TypeScript can judge.
   *
   * Three things are checked and each is worth the parameter it costs:
   *
   * - **the subject** is the author's own expression, so anything wrong inside it is reported where
   *   it is written;
   * - **every key must be assignable to the subject's type** — `K extends readonly S[]` — so an arm
   *   for a value the subject can never hold is a fault at the key;
   * The ARMS are not here. They are written as declarations of their own beside this call, so each
   * is judged by the property it sets and a fault lands on the arm rather than on this call — which
   * is what a single call could not do: measured, inferring the arms' type from the return position
   * gave `undefined` and every arm was reported against it.
   *
   * `never`, so the call sits among declarations the way `__cond` does.
   *
   * `_` is left out of the keys, because it stands for everything the others did not and there is
   * no type for that.
   */
  /**
   * And, with no `_`, **every value the subject can be has an arm** — the third argument, written
   * only then, at the word `match`. Its type is `true` when the keys cover the subject and a
   * sentence naming what is missing when they do not, so the error lands on the word and says it.
   * `const S`, so a subject written as a literal stays that literal instead of widening to `string`
   * — otherwise `$("nepostojecaVrednost")` takes keys it can never be. Only a finite union of
   * strings is asked: a plain `string` has no list to cover, and a subject that may be `undefined`
   * needs no arm for it — nothing is picked then.
   */
  /**
   * And **the subject is a string** — the third argument, `true`, written over the subject itself.
   *
   * An arm's key is a written word, so against a number or a boolean `1 => …` and `true => …` would
   * leave a reader asking which one it is. The user's decision, DESIGN.md §12: `match` takes a
   * string, a boolean is a choice, and a number becomes a word in code. The keys are then taken as
   * any string, so the refusal is said once, on the subject, instead of once per key.
   */
  write(
    `declare function ${lookup}<const S, const K extends readonly ([NonNullable<S>] extends [string] ? S : string)[]>(subject: S, keys: K, ` +
      "text: [NonNullable<S>] extends [string] ? true : [NonNullable<S>] extends [boolean] ? " +
      '"match takes a string — for a boolean, write $(on) ? a : b" : ' +
      `"match takes a string — name the cases in code, $(n > 2 ? 'large' : 'small')", whole?: ` +
      "[NonNullable<S>] extends [string] ? string extends NonNullable<S> ? true : " +
      "[Exclude<NonNullable<S>, K[number]>] extends [never] ? true : " +
      "`this match has no arm for ${Exclude<NonNullable<S>, K[number]> & string} — add one, or a _ arm for the rest` : true): never;",
  );

  const hole = binding(source, "__val");
  write(`declare function ${hole}<T extends import(${from}).CssValue>(value: T): T;`);

  /**
   * Every name this file DECLARED, so a consumer can tell them from the author's own.
   *
   * They are in scope for the whole file, which is what makes them work — and what made TypeScript
   * offer them beside the author's bindings in ordinary completions: measured, 1005 entries where
   * 1000 belong. `binding` already picks a name the source does not contain, so nothing of the
   * author's is ever removed by filtering these out.
   */
  const bindings: string[] = [block, lookup, condition, spread, hole, variables];

  /**
   * One more declaration per KIND of named site the file holds, and only the kinds it holds.
   *
   * A named site is a different vocabulary — frames, or descriptors — so it cannot go through the
   * same function, and a file with no named site should not pay for the types of one.
   *
   * **Its body is a single object literal, where an ordinary block is an array of them.** That is
   * the one place the reporting trade is worth losing: TypeScript reports one fault per literal, so
   * an array reports every fault at once — but only a whole literal can be MISSING something, and a
   * `@font-face` without `src` is the fault worth catching most. These bodies are three or four
   * lines, so the cost is bounded and the check is not available any other way.
   */
  const surfaces = new Map<string, string>();
  for (const site of sites) {
    if (site.at === undefined || surfaces.has(site.at)) continue;
    const shape = (SURFACES as Readonly<Record<string, string | undefined>>)[site.at];
    if (shape === undefined) continue;
    const name = binding(source, `__${site.at.replace(/-/g, "_")}`);
    bindings.push(name);
    surfaces.set(site.at, name);
    /**
     * `@@property( … )` is the one named site whose VALUE is worth something, so it alone returns.
     *
     * The others are written for their effect — a keyframe list, a face — and nothing sensible comes
     * back from writing one, so `never` is the honest return and it also refuses `const x = @@keyframes(…)`
     * being used as a value. A registered property is different: the name it generates is a string
     * that reads in a block and sets on an element, and the KIND it declared is exactly what a
     * setter needs to refuse a length where an angle was asked for.
     *
     * `const D` is what keeps `syntax: "<angle>"` a literal long enough for the kind to be read out
     * of it. Measured: excess-property checking survives the generic, so a descriptor that is not
     * one is still reported on its own key rather than swallowed by inference.
     */
    const returns = RETURNS[site.at as (typeof NAMED_BLOCKS)[number]];
    if (returns === undefined) write(`declare function ${name}(body: import(${from}).${shape}): never;`);
    else
      write(`declare function ${name}<const D extends import(${from}).${shape}>(body: D): import(${from}).${returns};`);
  }

  const preamble = code.length;

  /** Each block's interior, and where a caret inside it goes when no item claims it. */
  const slots: { from: number; to: number; at: number }[] = [];
  /**
   * Each declaration's extent in the author's file, and where its KEY is in the virtual one.
   *
   * For a caret that lands somewhere TypeScript will not answer about — inside a value's string
   * literal, inside a selector — so the question can be asked of the declaration instead.
   */
  const heads: { from: number; to: number; at: number }[] = [];

  /** The blocks written INSIDE the site being emitted, whose text is not TypeScript. */
  let nested: BlockSite[] = [];

  /** What a reference stands for, so the check reads the file the way the build compiles it. */
  const references = namedSites(source, { filename: options.filename, read: options.read });

  for (const site of sites) {
    // A `name=@@(` found INSIDE a block belongs to that block's text, not to the file. The transform
    // refuses one; here it is simply passed over, because this file exists to be type-checked and a
    // refusal belongs to the build.
    if (site.start < cursor) continue;

    const read = readBlock(source, site.open, "", {
      tolerant: options.tolerant,
      resolve: (name) => references.get(name),
    });
    nested = sites.filter((other) => other !== site && other.start > site.open && other.start < read.end);

    /**
     * How much of the author's text stands, and it is what the transform decides too: a bare JSX
     * attribute is rewritten from its NAME, because the braces are ours to add; the two expression
     * spellings keep everything to the left of the block, because there the braces are the author's
     * or would be wrong. See `BlockSite.wrap`.
     */
    /** A named site's own function and its single literal; `undefined` for an ordinary block. */
    const surface = site.at === undefined ? undefined : surfaces.get(site.at);
    /** Just inside a named site's literal — where a caret that claims nothing else belongs. */
    let inside = 0;

    if (surface !== undefined) {
      copy(cursor, site.start);
      /**
       * A named site written as a BARE ATTRIBUTE keeps the attribute.
       *
       * The rewrite starts at the site's own start, which for a bare attribute is the attribute's
       * NAME — so without this, `css=@@keyframes( … )` comes out `<div __keyframes({ … })`, with
       * `css=` gone and the whole file failing to parse. Nothing in it is then checked at all: the
       * build refuses it, and the author is owed a working editor until they run one.
       *
       * The `wrap` question is the same one the ordinary branch below asks. See `BlockSite.wrap`.
       */
      if (site.wrap) {
        copy(site.start, site.start + site.name.length);
        write("={");
      }
      write(`${surface}(`);
      /**
       * The literal's own brace stands for the block's OPENING, and it has to stand for something.
       *
       * A required descriptor that is missing is reported on the whole literal, not on any line
       * inside it — so if the brace maps nowhere the diagnostic has no home and is dropped, and a
       * `@font-face` with no `src` passes in silence. It maps to `@@font-face(`, which is where an
       * author would look for a fault about the block as a whole.
       */
      derived("{", site.start, site.open + 1 - site.start);
      inside = code.length;
    } else if (site.wrap) {
      copy(cursor, site.start);
      copy(site.start, site.start + site.name.length);
      write(`={${block}([`);
    } else {
      copy(cursor, site.start);
      write(`${block}([`);
    }
    lined = site.open;
    /**
     * The newlines the author wrote above something, put back before it is emitted.
     *
     * The default handles a block built by hand, which has no positions: nothing here produces one,
     * but the type allows it. `countNewlines` counts nothing for a span that runs backwards, so the
     * mark only ever moves forward.
     */
    const keepLine = (upTo = lined): void => {
      write("\n".repeat(countNewlines(source, lined, upTo)));
      lined = Math.max(lined, upTo);
    };
    items(read.block.items, read.holes, keepLine, surface !== undefined);

    /**
     * An empty object literal at the end of the block, **for an editor only**.
     *
     * Measured, and it is the state you are in first: with nothing typed yet, a caret in the block
     * belonged to no segment at all and got zero completions — as did a caret on a blank line after
     * a declaration, and one after a semicolon. Three of the four "nothing typed" positions.
     *
     * An empty literal is somewhere for that caret to be, and TypeScript offers every property name
     * inside one. `slots` records the block's interior so the reverse lookup can send anything the
     * items do not claim here.
     */
    if (tolerant) {
      /**
       * Somewhere for a caret that no run of text claims — see the note below on the empty literal.
       *
       * A named site gets no literal of its own to sit in: it IS one already, and a second `{}`
       * inside an object is a syntax error rather than a place. So its slot points just inside its
       * own brace. Pointed past the last declaration instead, it lands in the `})` that closes the
       * call, and measured, every caret in a named block got zero completions.
       */
      slots.push({ from: site.open, to: read.end, at: surface === undefined ? code.length + 1 : inside });
      if (surface === undefined) write("{},");
    }

    write(surface !== undefined ? (site.wrap ? "})}" : "})") : site.wrap ? "])}" : "])");

    // Whatever the block spanned below its last item — the closing `)` on a line of its own.
    keepLine(read.end + 1);

    cursor = read.end + 1;
  }
  copy(cursor, source.length);

  /** By author offset, for the reverse lookup. The forward list is already in virtual order. */
  const bySource = [...segments].sort((a, b) => a.source - b.source);

  return {
    code,
    preamble,
    bindings,
    helpers: { block, from: spread, hole, cond: condition, vars: variables },
    homeOf: (offset) => homeOf(segments, offset),
    spanOf: (start, length) => spanOf(segments, start, length),
    virtualOf: (offset) => virtualOf(bySource, offset) ?? slotFor(slots, offset),
    declarationOf: (offset) => declarationOf(heads, offset),
  };

  /**
   * One object literal PER DECLARATION, gathered in an array.
   *
   * Measured: TypeScript reports one failure per object literal and stops, so a block written as a
   * single literal with three faults in it reports one — and the author fixes it, re-runs, and meets
   * the next. An array of one-declaration literals reports all three at once, each with its own
   * position and its own suggestion, nested rules included.
   */
  function items(
    list: readonly BlockItem[],
    holes: readonly Span[],
    keepLine: (upTo?: number) => void,
    single = false,
  ): void {
    for (const item of list) {
      // The newlines the author wrote above this declaration, so it lands on its own line.
      keepLine(item.at);

      /**
       * Composition is checked BESIDE the declarations, not around them.
       *
       * A group's condition and a spread's operand are each their own array element — `never` is
       * assignable to a declaration, so a helper call sits among them — and each is written before
       * the object literal a declaration would open, because neither is one.
       *
       * **Measured, and it is why the encoding is this and not the obvious one:** writing a group as
       * `__when(condition, [ … ])` meant a wrong condition HID every fault under it, because the
       * failed inference degrades the whole call. Beside rather than around, everything comes back
       * at once. The grouping itself is written down nowhere, because nothing about it is a type
       * question — a declaration inside a group is checked exactly like one outside it.
       */
      /**
       * A branch of a chain is checked exactly as a `when` is: its condition beside it, and its
       * declarations beside that. A bare `else` has no condition, so only its declarations go.
       */
      const branch = item.kind === "rule" ? branchOf(item.prelude) : undefined;
      const guard = branch !== undefined && branch.kind !== "else" ? branch.hole : undefined;
      if (branch !== undefined && item.kind === "rule") {
        /**
         * A named block's body is a SINGLE object literal, and a call is not one of its members.
         *
         * Composition belongs to an element and a named block is not one, so `when` cannot go in
         * one — `composition-in-a-named-block` reports it. Written here anyway, it produces
         * `{__cond((on)),"& from":[…]}`, which does not parse, and a file that does not parse has
         * nothing checked in it at all.
         */
        if (!single && guard !== undefined) {
          write(`${condition}(`);
          expression(holes[guard]);
          write("),");
        }
        items(item.items, holes, keepLine, single);
        continue;
      }

      /**
       * A `match` is checked BESIDE the declarations too, and for the same reason composition is.
       *
       * The subject and its keys are one question — can this expression be these things — and each
       * arm is another: is this a value the property takes. Written as one call the arms would be
       * judged by the CALL's inference and a fault would land there; written as one declaration
       * each, every arm is judged by its own property and a fault lands on the arm.
       *
       * **The virtual file does not mirror the runtime shape and does not have to.** What it owes
       * is the same questions, asked where an author can act on the answers.
       */
      /**
       * A BLOCK match, the same two questions at the level of a group: the subject against its keys,
       * once, and then every arm's declarations beside it, each judged by its own property. The key's
       * span is the key alone, so a key the subject can never be is squiggled where it is written.
       */
      if (item.kind === "match") {
        // A forgiving read can hand a subject no hole holds; there is then nothing to check it against.
        if (!single && holes[item.hole] !== undefined) {
          matchCall(holes[item.hole], item.arms, item.at, (arm) => {
            const quoted = arm.at !== undefined && (source[arm.at] === '"' || source[arm.at] === "'");
            return arm.key.length + (quoted ? 2 : 0);
          });
        }
        for (const arm of item.arms) items(arm.items, holes, keepLine, single);
        keepLine(item.end);
        continue;
      }

      /**
       * A CHOICE, the same way: each condition beside, as a `when`'s is, and every branch as a
       * declaration of its own, so a wrong value lands on the branch that holds it.
       */
      const choice = item.kind === "declaration" ? item.value.find((part) => part.kind === "choice") : undefined;
      if (choice !== undefined && choice.kind === "choice" && item.kind === "declaration") {
        if (!single) {
          for (const branch of choice.branches) {
            // A condition that resolved to a name — a keyframes block — holds no expression to check.
            if (holes[branch.hole] === undefined) continue;
            write(`${condition}(`);
            expression(holes[branch.hole]);
            write("),");
          }
          const branches = [
            ...choice.branches.map((one) => ({ value: one.value, at: one.at, length: one.length })),
            { value: choice.otherwise, at: undefined, length: undefined },
          ];
          for (const one of branches) {
            // A runtime value is `hole-in-a-match-arm`'s to report; the type would say it again.
            if (one.value.length === 0 || one.value.some((part) => part.kind === "hole")) continue;
            const first = one.value[0];
            const last = one.value[one.value.length - 1];
            const from = first.at ?? one.at;
            const to = (last.at ?? 0) + (last.kind === "text" ? last.text.length : (last.length ?? 0));
            write("{");
            /**
             * The KEY stands for the branch's value, not for the property: TypeScript reports a value
             * the property does not take on the key, and two branches on one line share the property,
             * so a squiggle there could not say which branch is wrong.
             */
            derived(key(propertyName(item.property)), from, from === undefined ? undefined : to - from);
            write(":");
            value(one.value, from, to, holes);
            write("},");
          }
        }
        keepLine(item.end);
        continue;
      }

      const chosen = item.kind === "declaration" ? item.value.find((part) => part.kind === "match") : undefined;
      if (chosen !== undefined && chosen.kind === "match" && item.kind === "declaration") {
        if (!single && holes[chosen.hole] !== undefined) {
          matchCall(holes[chosen.hole], chosen.arms, chosen.at, (arm) => arm.length);

          for (const arm of chosen.arms) {
            // A runtime value is `hole-in-a-match-arm`'s to report; the type would say it again.
            if (arm.value.length === 0 || arm.value.some((part) => part.kind === "hole")) continue;
            write("{");
            derived(key(propertyName(item.property)), item.at, item.property.length);
            write(":");
            value(arm.value, arm.at, arm.at === undefined ? undefined : arm.at + (arm.length ?? 0), holes);
            write("},");
          }
        }
        keepLine(item.end);
        continue;
      }

      const spreading = item.kind === "declaration" ? holeIn(item.property, SPREAD) : undefined;
      if (spreading !== undefined && item.kind === "declaration") {
        // The same reason, and the same rule reports it.
        if (!single) {
          write(`${spread}(`);
          expression(holes[spreading]);
          write("),");
        }
        keepLine(item.end);
        continue;
      }

      if (!single) write("{");
      if (item.kind === "rule") {
        if (item.at !== undefined) {
          heads.push({ from: item.at, to: item.preludeEnd ?? item.at, at: code.length + 1 });
        }
        /**
         * The SAME question `flatten` asks, asked by the same function.
         *
         * A prelude naming no parent is a descendant of it — `div { … }` is `& div`.
         * `CssBlockShape` admits a nested rule only under a key beginning with `&` or `@`, so
         * writing the author's bytes as the key makes `div { color: red; }` a `TS2353` in the
         * editor on code the build compiles and ships. An at-rule's prelude is not a selector and
         * is left alone, which is the split `flatten` makes one line further down.
         */
        const key =
          item.prelude.trimStart().startsWith("@") || branchOf(item.prelude) !== undefined
            ? item.prelude
            : selectorOf(item.prelude);
        derived(quoted(key), item.at, (item.preludeEnd ?? item.at ?? 0) - (item.at ?? 0));
        write(":[");
        items(item.items, holes, keepLine);
        write("]");
      } else {
        if (item.at !== undefined) heads.push({ from: item.at, to: item.end ?? item.at, at: code.length + 1 });
        derived(key(propertyName(item.property)), item.at, item.property.length);
        write(":");
        value(item.value, item.valueAt, item.end, holes);
        keepLine(item.end);
      }
      write(single ? "," : "},");
    }
  }

  /**
   * A declaration's value, in the form that carries the most type information.
   *
   * Three shapes, and the choice is what decides which diagnostic the author gets:
   *
   * - **the whole value is one hole** — the expression itself, so it is checked against the
   *   property's own type and `padding: $(nekaFunc())` is a `TS2322` about `padding`;
   * - **no holes at all** — a string literal, so a union-typed property gives `TS2820` with *did you
   *   mean*, which a template literal would not;
   * - **text and holes together** — a template literal, so `padding: $(n)px` is checked against
   *   `` `${number}px` `` rather than collapsing to `string`.
   */
  function value(
    parts: readonly ValuePart[],
    at: number | undefined,
    end: number | undefined,
    holes: readonly Span[],
  ): void {
    const length = at === undefined || end === undefined ? undefined : end - at;

    if (parts.length === 1 && parts[0].kind === "hole") {
      valueHole(holes[parts[0].index]);
      return;
    }

    /**
     * The value is ONE variable, with nothing beside it but whitespace.
     *
     * Bare rather than wrapped, for two reasons and the second is not cosmetic. Wrapped in a
     * template literal it would be a `string` and the property's own type would have nothing left to
     * judge. And a path BEING TYPED carries its trailing dot — `__vars.color.` — which is a syntax
     * error inside `${ … }`: measured, the whole virtual file then failed to parse and the editor
     * offered nothing exactly where the variable groups belong.
     *
     * Whitespace counts as nothing here because it is: a value is collapsed before it is compared,
     * so `color: $color.accent.main ` and the same without the space are one declaration.
     */
    const written = parts.filter((part) => part.kind !== "text" || part.text.trim() !== "");
    if (written.length === 1 && written[0].kind === "variable") {
      variablePath(written[0]);
      return;
    }

    if (!parts.some((part) => part.kind === "hole" || part.kind === "variable")) {
      derived(quoted(collapse(parts.map((part) => (part.kind === "text" ? part.text : "")).join(""))), at, length);
      return;
    }

    write("`");
    for (const [index, part] of parts.entries()) {
      if (part.kind === "text") {
        /**
         * The PART's own position, not the whole value's.
         *
         * If every text run in a value recorded `at = valueAt`, a value with a hole in it would
         * have two or three runs all claiming the value's first character. The reverse lookup sorts
         * by author offset, and a run that starts where an earlier one does sorts before the hole
         * between them — so every author offset past the first hole would map nowhere. Measured by
         * sweeping every offset in a block.
         *
         * A run this compiler DECIDED — a resolved reference — has an `at` where the `{{` was and a
         * different length, so it keeps the whole-value fallback: there is no position in the
         * author's file that its characters correspond to. See `TextPart.resolved`.
         */
        const own = part.resolved || part.at === undefined;

        /**
         * **A space at a part's BOUNDARY is meaning, and `collapse` trims both ends of what it is
         * given.**
         *
         * Collapsed run by run, the space between the text and the expression beside it disappears:
         * `border: 1px solid {accent}` becomes `` `1px solid${x}` ``, which says the value is `1px
         * solidred`, and `gap: 4px $space.gutter.tight` is refused by a multi-value type because
         * the two values run together. The emitted CSS is unaffected — `flatten` collapses the
         * whole value at once — but a property's type reads the SHAPE of this one.
         */
        const collapsed = collapse(part.text);
        const before = index > 0 && /^\s/.test(part.text) ? " " : "";
        const after = index < parts.length - 1 && /\s$/.test(part.text) ? " " : "";

        derived(inTemplate(`${before}${collapsed}${after}`), own ? at : part.at, own ? length : part.text.length);
        continue;
      }
      /**
       * `$color.primary.main` — written as the TypeScript expression it is, inside the template.
       *
       * **This is where the spelling earns its keep**, and it is the whole reason a variable reaches
       * the AST as its own part instead of as resolved text. Here it becomes a real member
       * expression, so the language service answers everything about it for free: completion one
       * level at a time, the kind at the use site, go-to-definition, and rename.
       *
       * `$` is BOUND by the virtual file rather than left to the author's imports — see the
       * declaration in the preamble for the measurement that settled that.
       *
       * The expression is `derived` rather than copied: `$space.inline.2xl` is writable in a block
       * and does not parse as TypeScript, so the virtual file spells that segment `["2xl"]` and the
       * two lengths differ. Mapping the whole path to its own span is what puts a diagnostic on the
       * path and a caret inside it.
       */
      if (part.kind === "variable") {
        write("${");
        variablePath(part);
        write("}");
        continue;
      }
      if (part.kind === "match" || part.kind === "choice") continue;
      write("${");
      valueHole(holes[part.index]);
      write("}");
    }
    write("`");
  }

  /**
   * A `$` path, emitted SEGMENT BY SEGMENT rather than as one run.
   *
   * As one run, every caret inside a path maps by raw offset into a virtual string of a different
   * length: `$color.accent.` is 15 characters and `__vars.color.accent.` is 20, so a caret at the
   * end of the author's text lands in the middle of `accent` and the editor offers the members of
   * `$color` — one level too shallow, silently.
   *
   * Each segment is its own run against its own author span, so a caret anywhere in the path maps
   * where it belongs. The `$` itself is derived — it becomes a name of ours — and so is a segment
   * that has to be bracketed; the rest is the author's own bytes.
   */
  function variablePath(part: VariablePart): void {
    const at = part.at;
    if (at === undefined || part.length === undefined) {
      derived(expressionFor(part.path, variables, part.open === true), at, part.length);
      return;
    }

    const written = source.slice(at, at + part.length);
    /**
     * A `$` alone, being typed: the dot is ours, so the caret after the `$` asks for the groups. The
     * dot stands for the `$`, one character for one, so that caret lands AFTER it — a rewritten run
     * would place it inside `__vars`, where TypeScript offers every global instead.
     */
    if (written === "$" && part.open === true) {
      code += variables;
      derived(".", at, 1);
      return;
    }
    derived(variables, at, 1);

    /**
     * The group follows the `$` with no dot — `$color` is `__vars.color` — so the first segment is
     * its own run, with the dot the TypeScript needs written by us.
     */
    {
      const from = 1;
      let end = from;
      while (end < written.length && written[end] !== ".") end += 1;
      if (end > from) {
        const segment = written.slice(from, end);
        derived(isIdentifier(segment) ? `.${segment}` : `[${JSON.stringify(segment)}]`, at + from, end - from);
      }
    }

    /**
     * Walked rather than split, because a split loses which dot is which.
     *
     * `$color.accent.` splits to `["", "color", "accent", ""]` and the empty ends are the leading
     * and trailing dots — indistinguishable once they are array elements, so one dot can come out
     * as two. Walking keeps every character where it was written.
     */
    let index = 1;
    while (index < written.length && written[index] !== ".") index += 1;
    while (index < written.length) {
      if (written[index] !== ".") break;
      const dot = index;
      index += 1;

      const from = index;
      while (index < written.length && written[index] !== ".") index += 1;

      /** A dot with nothing after it: the trailing one a path being typed ends with. */
      if (index === from) {
        derived(".", at + dot, 1);
        continue;
      }

      /**
       * The dot and its segment are ONE run, because a bracketed segment has no dot in front of it.
       *
       * `.2xl` becomes `["2xl"]` — four of the author's characters for seven of ours, and no dot at
       * all. Emitting the dot separately put one there: `__vars.space.inline.["2xl"]`, which does
       * not parse.
       */
      const segment = written.slice(from, index);
      const emitted = isIdentifier(segment) ? `.${segment}` : `[${JSON.stringify(segment)}]`;
      derived(emitted, at + dot, index - dot);
    }
  }

  /**
   * One `match`'s call to the helper, at either level: the subject, its keys, a `true` over the
   * subject that says it is a string, and — with no `_` — a `true` over the word that says every
   * value has an arm. The two levels differ only in how long a key's span is, so that is passed in.
   */
  function matchCall(
    subject: Span,
    arms: readonly {
      readonly key: string;
      readonly otherwise?: boolean;
      readonly at?: number;
      readonly length?: number;
    }[],
    at: number | undefined,
    keySpan: (arm: { readonly key: string; readonly at?: number; readonly length?: number }) => number | undefined,
  ): void {
    write(`${lookup}(`);
    expression(subject);
    write(", [");
    for (const [index, arm] of arms.filter((one) => !one.otherwise).entries()) {
      if (index > 0) write(", ");
      derived(JSON.stringify(arm.key), arm.at, keySpan(arm));
    }
    write("], ");
    derived("true", subject.start, subject.end - subject.start);
    if (!arms.some((arm) => arm.otherwise)) {
      write(", ");
      derived("true", at, MATCH.length);
    }
    write("),");
  }

  /**
   * One hole's expression, byte for byte where the author wrote it.
   *
   * Parenthesised, so a comma or a low-precedence operator inside cannot change what the surrounding
   * syntax means — and the parens are written rather than copied, so nothing maps to them.
   */
  function expression(span: Span): void {
    write("(");
    /**
     * A HOLE HOLDING ANOTHER BLOCK is written as a placeholder rather than copied.
     *
     * `color: {cond ? @@( … ) : "blue"}` is refused by the build — a hole holds a value and a block
     * is not one — but copying it here put `@@(` into the virtual TSX, and **a file that does not
     * parse has no semantics to ask about**, so every other fault in it went unreported. Measured:
     * sixteen parse errors and nothing else checked.
     *
     * `null` rather than nothing, because the slot has to hold an expression. Nothing is copied, so
     * no offset inside it maps home — which is right: the expression is refused, and a caret in it
     * has no answer that would help.
     */
    if (nested.some((one) => one.start >= span.start && one.start < span.end)) write("null");
    else copy(span.start, span.end);
    write(")");
  }

  /**
   * A hole standing for a VALUE, which is the only kind that has to be one.
   *
   * A guard's hole and a spread's operand each have a helper of their own with a type of its own, so
   * neither comes through here — a condition is any expression at all, and a spread takes a block.
   */
  function valueHole(span: Span): void {
    write(`${hole}(`);
    // `expression` and not `copy`: its parens are what keep a comma inside the hole from becoming a
    // SECOND ARGUMENT here, which would silently make the check ask about the wrong expression.
    expression(span);
    write(")");
  }
}

/**
 * Where the author's leading comments end, which is where a `declare` of ours may first go.
 *
 * Whitespace, comments, and a SHEBANG — the first thing that is neither is where the file's own
 * code begins, and a directive that has to be above it stays above it. A file that is nothing but
 * comments has no code to put anything in front of, so the whole file is trivia and the answer is
 * its length.
 *
 * `#!` is not JavaScript and is not a comment, and it is legal ONLY at offset 0 — so a `declare`
 * written in front of it gives `'#!' can only be used at the start of a file`, and a file that does
 * not parse has nothing checked in it at all. `afterShebang` is the one answer `transform` and
 * `findBlocks` use too.
 */
function afterLeadingTrivia(source: string): number {
  let at = afterShebang(source);
  while (at < source.length) {
    const code = source.charCodeAt(at);
    if (code === 32 || code === 9 || code === 10 || code === 13 || code === 12) {
      at++;
      continue;
    }
    if (code === 47 /* / */ && source.charCodeAt(at + 1) === 47) {
      const end = source.indexOf("\n", at + 2);
      at = end === -1 ? source.length : end + 1;
      continue;
    }
    if (code === 47 && source.charCodeAt(at + 1) === 42 /* * */) {
      const end = source.indexOf("*/", at + 2);
      at = end === -1 ? source.length : end + 2;
      continue;
    }
    return at;
  }
  return at;
}

/**
 * Which type a named site's body is checked against.
 *
 * Written here rather than derived, because there is nothing to derive it from: `@keyframes` holds
 * frames, and the other two hold descriptors that only their own at-rule accepts.
 *
 * Keyed on `NAMED_BLOCKS`, the one list of what a `@@name( … )` may be, so the type makes this
 * table impossible to drift from the list. A name in neither would get no NAMED check and the
 * ORDINARY one would take over: `@@keyfrmes( … )` read as a block, `from { … }` as the selector `&
 * from`, and a report about a nested rule. `unknown-named-block` reports the name instead.
 */
const RETURNS: Readonly<Partial<Record<(typeof NAMED_BLOCKS)[number], string>>> = {
  property: "CssRegistered<D>",
};

const SURFACES: Readonly<Record<(typeof NAMED_BLOCKS)[number], string>> = {
  keyframes: "CssKeyframesShape",
  "font-face": "CssFontFaceDescriptors",
  property: "CssPropertyDescriptors",
};

/** How many newlines the author wrote between two offsets. */
function countNewlines(source: string, from: number, to: number): number {
  let lines = 0;
  for (let index = from; index < to; index++) {
    if (source.charCodeAt(index) === 10) lines++;
  }
  return lines;
}

/**
 * The virtual offset an author offset became.
 *
 * A copied run maps offset for offset. A REWRITTEN one — a quoted key, a folded value — has no such
 * correspondence, so the caret is placed proportionally inside the emitted text and clamped to stay
 * inside it. Measured on a plain object literal: what matters is being inside the token, not being at
 * an exact character, because that is what decides whether TypeScript offers the keys.
 */
function virtualOf(bySource: readonly Segment[], offset: number): number | undefined {
  let low = 0;
  let high = bySource.length - 1;
  let found: Segment | undefined;

  while (low <= high) {
    const middle = (low + high) >> 1;
    const segment = bySource[middle];
    if (offset < segment.source) high = middle - 1;
    else {
      found = segment;
      low = middle + 1;
    }
  }

  // Past the text this segment stands for, so it belongs to nothing yet — a blank line, a caret
  // after a semicolon. The caller sends those to the block's empty slot.
  if (found === undefined || offset > found.source + found.sourceLength) return undefined;

  const length = found.to - found.from;
  const delta = offset - found.source;

  // A copied run: the same characters, so the same distance.
  if (length === found.sourceLength) return found.from + delta;

  /**
   * A rewritten one: inside the emitted token, never at its far edge. Measured — `{display|:`
   * offers nothing and `{displa|y` offers every property name, so being inside is what matters.
   *
   * **A ONE-CHARACTER run has no interior.** `Math.max(length - 1, 1)` is 1 for such a run, which
   * is one past its only character — and the whole header of a named block is one: `derived("{", …
   * )` stands for all twelve characters of `@@keyframes(`.
   */
  if (length <= 1) return found.from;
  return found.from + Math.min(Math.max(delta, 1), length - 1);
}

/** The author's span for a virtual one — see the declaration on {@link VirtualFile}. */
function spanOf(
  segments: readonly Segment[],
  start: number,
  length: number,
): { start: number; length: number } | undefined {
  const segment = containing(segments, start);
  if (segment === undefined) return undefined;

  const from = segment.source + (start - segment.from);

  if (segment.copied) {
    // Both ends are real. A span running past this run is clamped to it rather than guessed at — a
    // highlight that is too short is readable, one that covers invented text is not.
    return { start: from, length: Math.min(length, segment.source + segment.sourceLength - from) };
  }

  return { start: segment.source, length: segment.sourceLength };
}

/** The run an offset falls in. */
function containing(segments: readonly Segment[], offset: number): Segment | undefined {
  let low = 0;
  let high = segments.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const segment = segments[middle];
    if (offset < segment.from) high = middle - 1;
    else if (offset >= segment.to) low = middle + 1;
    else return segment;
  }
  return undefined;
}

/**
 * The key of whichever declaration the offset falls in.
 *
 * Innermost first — a declaration inside a nested rule is inside that rule's extent too, and the
 * narrower answer is the one a reader meant.
 */
function declarationOf(heads: readonly { from: number; to: number; at: number }[], offset: number): number | undefined {
  let best: { from: number; to: number; at: number } | undefined;

  for (const head of heads) {
    if (offset < head.from || offset > head.to) continue;
    if (best === undefined || head.to - head.from < best.to - best.from) best = head;
  }

  return best?.at;
}

/** The empty slot of whichever block the offset is inside, for a caret that has typed nothing. */
function slotFor(slots: readonly { from: number; to: number; at: number }[], offset: number): number | undefined {
  for (const slot of slots) {
    if (offset > slot.from && offset <= slot.to) return slot.at;
  }
  return undefined;
}

/** The last segment starting at or before `offset`, or nothing when the offset is scaffolding. */
function homeOf(segments: readonly Segment[], offset: number): number | undefined {
  let low = 0;
  let high = segments.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const segment = segments[middle];
    if (offset < segment.from) high = middle - 1;
    else if (offset >= segment.to) low = middle + 1;
    // A copied run maps offset for offset; a rewritten one maps to where it started, which is the
    // position a reader needs anyway — a *did you mean* about `dsiplay` belongs on `dsiplay`.
    else return segment.copied ? segment.source + (offset - segment.from) : segment.source;
  }
  return undefined;
}

function quoted(text: string): string {
  if (/^-?\d+(?:\.\d+)?$/.test(text.trim())) return text.trim();
  return JSON.stringify(text);
}

/**
 * A property name as an object key — **unquoted whenever it can be**, and that is not cosmetic.
 *
 * Measured, the same typo against the same type:
 *
 *     { dsiplay: "flex" }     TS2561 … Did you mean to write 'display'?
 *     { "dsiplay": "flex" }   TS2353 … and '"dsiplay"' does not exist in type
 *
 * **A quoted key gets no suggestion.** TypeScript's own *did you mean* is the headline of the whole
 * type-safety claim, and it turns out to hang on whether the emitted key needed quotes. So a name
 * that is a valid identifier is written bare.
 *
 * A dashed name — `flex-direction`, `border-left` — cannot be, so those still get the plain message.
 * That is a limit, not a workaround: the alternative is camelCase keys, which would suggest
 * `flexDirection` to somebody writing CSS, and the fix would then have to be a rewritten compiler
 * message. Naming the near miss for a dashed property belongs to the CSS checker, where the message
 * is one we write.
 */
function key(property: string): string {
  return IDENTIFIER.test(property) ? property : quoted(property);
}

/**
 * How deep a narrowed block's states take the CSS-wide keywords: the block, a state in it, and two
 * more — `@media` holding a `&:hover` is three. Written out level by level, because a named
 * recursive type is a GLOBAL in a file that is a script, and two such files declared it twice
 * (`TS2300`), measured. Below the last level a value is checked as written, without the keywords.
 */
const WIDENED_DEPTH = 4;

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** Text going inside a template literal: the two things that would end it, and the escape itself. */
function inTemplate(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

function binding(source: string, base: string): string {
  let name = base;
  while (source.includes(name)) name = `_${name}`;
  return name;
}
