import type { Block, BlockItem } from "./ast";
import { HOLE, collapse, propertyName } from "./normalise";
import { MAY_CLEAR, SHORTHANDS } from "./keywords.generated";
import { widthSlot } from "../conditions";
import { CONDITION, SPREAD, holeIn } from "./read";

/**
 * One declaration, taken out of the block it was written in.
 *
 * A whole block is one class and one rule, so nothing ever had to say what a block SETS. Composition
 * does: two blocks merge by keeping, per thing set, the one written later — so each declaration
 * needs a name for the thing it sets, and that name has to be equal exactly when two declarations
 * target the same thing.
 */
export interface AtomicDeclaration {
  /**
   * What this declaration sets, canonically — `display`, `:hover|background`,
   * `@media (min-width: 40rem)|:hover|color`.
   *
   * Two declarations with the same key are the same thing set twice, and the later one wins. It is
   * never parsed back, only compared, which is why the parts can share a separator that a selector
   * is allowed to contain.
   */
  readonly key: string;
  /** The property alone, which is what the sheet orders by. */
  readonly property: string;
  /**
   * The text this declaration hashes as, holes standing in as placeholders.
   *
   * `property:value;`, canonical — the RULE's body, and what the sheet writes between the braces.
   * Not the whole identity of a rule: see {@link AtomicDeclaration.identity}.
   */
  readonly canonical: string;
  /**
   * Everything that makes this rule THAT rule: its context and its text.
   *
   * The class name is the hash of this and not of {@link canonical} alone, and the difference was a
   * silent fault. `color: red` and `&:hover { color: red }` have the same text and are two different
   * rules — measured, they hashed the same, the sheet kept whichever arrived first, and the hover
   * one was emitted with no selector, so it applied always. Across files neither block need know
   * about the other, and the sheet's collision assertion could not see it either, because the css
   * text really was identical.
   */
  readonly identity: string;
  /** Appended to the class in the selector — `:hover`, ` .title`, `""` for the class alone. */
  readonly selector: string;
  /** The conditional at-rules around it, sorted — see {@link flatten}. */
  readonly conditions: readonly string[];
  /** The BLOCK's hole indices this declaration uses, in the order it uses them. */
  readonly holes: readonly number[];
  /** Where it was written, so a finding lands on it. */
  readonly at?: number;
}

/**
 * The distinct breadths a property can have, WIDEST first — the sheet's minor order.
 *
 * From the generated shorthand table, so it is known before a build: twelve of them. `all` covers
 * 41 properties and comes first; a longhand covers none and comes last.
 */
const BREADTHS: readonly number[] = (() => {
  const found = new Set<number>([0]);
  for (const covered of Object.values(SHORTHANDS)) found.add(covered.length);
  return [...found].sort((a, b) => b - a);
})();

/** How many properties a declaration's own property clears. */
function breadthOf(declaration: { property?: string }): number {
  return declaration.property === undefined ? 0 : (SHORTHANDS[declaration.property]?.length ?? 0);
}

export { widthSlot } from "../conditions";

/**
 * Where a declaration's rule goes in the stylesheet, and it is a RULE rather than an accident.
 *
 * The merge decides which classes land on an element; three things it cannot decide are the sheet's,
 * and all three were measured in Chromium:
 *
 * - **a conditional rule beats an unconditional one for the same property only if emitted after it**;
 * - **a longhand emitted before a shorthand loses to it**, whatever the call site said;
 * - **of two breakpoints that both match, the one emitted later wins** — see {@link widthSlot}.
 *
 * So: by how narrow the rule is, and within that the broadest property first — measured by how many
 * other properties it clears, which is what the shorthand table already knows.
 *
 * **One definition, used twice.** The sheet emits in this order and `override-out-of-order` reports
 * where it contradicts the order the author wrote. Two copies of that question is the shape this
 * package keeps finding a fault in.
 */
export function sheetRank(declaration: { property?: string; conditions?: readonly string[] }): number {
  return widthSlot(declaration.conditions) * 100 + BREADTHS.indexOf(breadthOf(declaration));
}

/**
 * The nested cascade layer a rule goes in, as the path under `ramonda` — and it is the fix for a
 * fault no author could have seen.
 *
 * **One rule is written into the stylesheet of every file that names it** — that is what lets a chunk
 * stand on its own, and it is measured (an owner-per-rule left a lazily-loaded route naming a class
 * no stylesheet held). But a stylesheet is a SEQUENCE, so a file re-emitting a shared rule puts it
 * after the rules of whichever file loaded first, and same-specificity later-wins undoes the order
 * the rank promised. Measured in Chromium through a real build: `Card.tsx` writing `color: red` and
 * `@media { color: blue }` rendered blue on its own and RED once an innocent `Panel.tsx` — which
 * writes only `color: red` — loaded after it. Adding an unrelated component moved a page nobody
 * edited, and nothing could report it.
 *
 * A layer answers it because a layer's place is fixed by its DECLARATION and not by where its rules
 * are. What a layer needs is a NAME, and the order of the names has to be declared identically by
 * every stylesheet — a file declaring only what it uses is worse than useless, since CSS appends a
 * name it has not seen to the END of the order.
 *
 * **What this buys is not that the dev server matches the build.** Measured both ways on a real dev
 * server and a real `vite preview` of the same app: before any of this they already agreed, and both
 * were wrong. What moved is that a rule's place in the cascade is now a function of the RULE — not of
 * which files are in the build, and not of when a chunk arrives. The control is the sharpest
 * statement of it: with the layers off, clicking a button that loads a lazy chunk changed the colour
 * of an element already on the page, which has nothing to do with that chunk. See
 * `prototype-dev-vs-build.mjs`.
 *
 * ## Why the conditional half is a path of digits
 *
 * An unconditional rule has one of twelve breadths, so twelve names cover it and every stylesheet
 * lists all twelve. A breakpoint is a number, and thousands of names cannot be listed — so the width
 * slot is written as its DIGITS, one nested layer each, and every level's list is the same ten names
 * in every file. `min-width: 640px` is slot 5641, so it lands in `ramonda.c.d0.d5.d6.d4.d1` — the
 * five digits, and then its breadth.
 *
 * Nesting is what makes it cheap: a statement inside a layer block names no prefix. Measured on a
 * stylesheet holding seven rules, the whole scheme costs about 150 gzipped bytes. And the common case
 * stays flat — an unconditional rule is `ramonda.u07`, two levels, no tree.
 *
 * Measured in Chromium through the real sheet: 600 load orders of random rule sets across three
 * files, each through no minifier, esbuild and lightningcss, zero wrong. See `prototype-layers.mjs`.
 */
export function layerPathFor(declaration: { property?: string; conditions?: readonly string[] }): string[] {
  const breadth = String(BREADTHS.indexOf(breadthOf(declaration))).padStart(2, "0");
  const slot = widthSlot(declaration.conditions);
  if (slot === 0) return [`u${breadth}`];

  return [
    "c",
    ...String(slot)
      .padStart(5, "0")
      .split("")
      .map((digit) => `d${digit}`),
    `b${breadth}`,
  ];
}

/** The names one level of the digit path may hold, in order. */
export const DIGIT_LAYERS: readonly string[] = [...Array(10).keys()].map((one) => `d${one}`);

/** The names a breadth level may hold, in order — widest first. */
export const BREADTH_LAYERS: readonly string[] = BREADTHS.map((_, at) => String(at).padStart(2, "0"));

/**
 * The statement every stylesheet begins with: each unconditional breadth, then everything
 * conditional.
 *
 * The whole list, and that is not caution. Measured: a stylesheet declaring only the layers it uses
 * put a shorthand's layer AFTER a longhand's, because a file holding just `margin-left` loaded first
 * and CSS appends an unseen name to the end of the order — `margin-left: 4px` became `0px`.
 */
export const LAYER_ORDER = `@layer ${[...BREADTH_LAYERS.map((one) => `ramonda.u${one}`), "ramonda.c"].join(",")};`;

/** Whether a shorthand sets everything another property sets, so a later one CLEARS it in the merge. */
export function covers(shorthand: string, other: string): boolean {
  return SHORTHANDS[shorthand]?.includes(other) ?? false;
}

/**
 * Whether one property MIGHT cover another, with the writing mode deciding whether it does.
 *
 * `margin-inline` is left and right in a horizontal writing mode and top and bottom in a vertical
 * one — measured in Chromium — so `margin-left: 4px; margin-inline: 8px` has two right answers and
 * a stylesheet has one order. It cannot be cleared, and it cannot be ordered, so it is reported.
 *
 * The table holds physical targets only. Two logical names on different axes never overlap in any
 * mode, and listing them would report correct CSS.
 */
function mayCover(one: string, other: string): boolean {
  return MAY_CLEAR[one]?.includes(other) ?? false;
}

/** Whether two properties fight over anything — the same one, or one covering the other. */
export function conflict(a: string, b: string): boolean {
  return a === b || covers(a, b) || covers(b, a) || mayCover(a, b) || mayCover(b, a);
}

/** Whether the pair is the one no writing mode settles, which the report has to say out loud. */
export function onlyTheModeDecides(a: string, b: string): boolean {
  return !covers(a, b) && !covers(b, a) && (mayCover(a, b) || mayCover(b, a));
}

/**
 * A block, taken apart into the declarations it makes.
 *
 * ## The key is canonical rather than as-written, and both halves are measured
 *
 * - **At-rules are sorted**, because they commute: measured in Chromium,
 *   `@media X { @supports Y { … } }` and `@supports Y { @media X { … } }` are the same rule. Keyed
 *   as written, two authors writing the same CSS in a different nesting order would get different
 *   keys — and a modifier would silently fail to override a base.
 * - **Selector parts compose in order**, because they do not commute: `&:hover` inside `& .title` is
 *   `& .title:hover` and the reverse is a different element.
 *
 * ## Holes are renumbered per declaration
 *
 * A hole's index belongs to the BLOCK, so `color: {{x}}` is hole 0 alone and hole 1 under another
 * declaration — the same declaration with two canonical texts, two classes, and the dedupe that pays
 * for this whole design gone. The placeholder carries the LOCAL index and {@link AtomicDeclaration.holes}
 * says which of the block's holes those are.
 *
 * ## What it does not do
 *
 * Nothing here decides identity beyond the text: number forms, colour forms and keyword case are
 * left alone for the reason `normalise` gives — a wrong merge changes a page nobody edited, and a
 * missed one costs a duplicate rule.
 */
/**
 * One argument of the merge a block compiles to.
 *
 * A run of declarations under the same guards is ONE map — not one each — a spread is another
 * block's map, and the guards are the conditions of the `if` groups it sits inside.
 *
 * **Nesting is a conjunction**, which is why the guards are a flat list rather than a tree. That is
 * only correct because the merge is associative, which was measured over 50,301 random groupings
 * drawn from one shorthand family: zero disagreements between a nested merge and a flat one.
 */
export type AtomicSegment =
  | { readonly kind: "declarations"; readonly guards: readonly number[]; readonly items: AtomicDeclaration[] }
  | {
      readonly kind: "spread";
      readonly guards: readonly number[];
      readonly hole: number;
      /**
       * The selector and conditions it was written under, which must both be empty.
       *
       * A spread merges a whole block, and a block's map carries the context each of its own
       * declarations was written in — so nesting one inside a selector would have to re-scope every
       * key it holds, which a merge cannot do and the author did not ask for. Recorded rather than
       * refused here, because `flatten` describes and the transform decides.
       */
      readonly selector: string;
      readonly conditions: readonly string[];
      /** Where it was written, so the refusal lands on it. */
      readonly at?: number;
    };

/** Every declaration a block makes, ignoring how it is composed. */
/**
 * `!important`, however it is spelt — the same pattern `rules.ts` matches for a custom property's
 * value, because it is the same question asked of the same text.
 */
const IMPORTANT = /!\s*important\s*$/i;

export function flatten(block: Block): AtomicDeclaration[] {
  return segments(block).flatMap((one) => (one.kind === "declarations" ? one.items : []));
}

/**
 * A block as the arguments of one merge, in the order the author wrote them.
 *
 * `flatten` answers *what does this set*; this answers *how is it composed*. Two functions because
 * most of the package only needs the first — the rules, the sheet and the checker all ask what a
 * block sets and never how it was assembled.
 */
export function segments(block: Block): AtomicSegment[] {
  const out: AtomicSegment[] = [];
  walk(block.items, "", [], [], out);
  return out;
}

function walk(
  items: readonly BlockItem[],
  selector: string,
  conditions: readonly string[],
  guards: readonly number[],
  out: AtomicSegment[],
): void {
  /** The run being built, so declarations under one guard are one map rather than one each. */
  const run = (): AtomicDeclaration[] => {
    const last = out[out.length - 1];
    if (last?.kind === "declarations" && same(last.guards, guards)) return last.items;
    const fresh: AtomicDeclaration[] = [];
    out.push({ kind: "declarations", guards: [...guards], items: fresh });
    return fresh;
  };

  for (const item of items) {
    if (item.kind === "rule") {
      const condition = holeIn(item.prelude, CONDITION);
      if (condition !== undefined) {
        const before = out.length;
        walk(item.items, selector, conditions, [...guards, condition], out);
        /**
         * A group that produced NOTHING still emits its guard, as an empty run.
         *
         * `@media print { }` is legal CSS that does nothing, so `if ({x}) { }` is legal here that
         * does nothing — and commenting a group's body out is how somebody reaches it. But the
         * emission counts on one segment per recorded hole: `readBlock` records the condition's
         * `{expr}` whatever the group holds, and without this the guard had a hole and no segment,
         * so every following piece of text slid one place left.
         *
         * Measured before this line existed: `if ({variant}) { }` alone compiled to
         * `_merge(variant)`, which parses, runs, and ships `class="l g"` for `variant = "lg"` —
         * two class names that never existed, with nothing downstream able to notice.
         *
         * An empty run contributes no declaration, so the guard is evaluated and applies nothing,
         * which is what the browser does with the empty at-rule this mirrors.
         */
        if (out.length === before) out.push({ kind: "declarations", guards: [...guards, condition], items: [] });
        continue;
      }
      if (item.prelude.trimStart().startsWith("@")) {
        walk(item.items, selector, [...conditions, collapse(item.prelude)], guards, out);
        continue;
      }
      walk(item.items, nested(selector, selectorOf(item.prelude)), conditions, guards, out);
      continue;
    }

    const spread = holeIn(item.property, SPREAD);
    if (spread !== undefined) {
      out.push({ kind: "spread", guards: [...guards], hole: spread, selector, conditions, at: item.at });
      continue;
    }

    run().push(declarationOf(item, selector, conditions));
  }
}

/** One declaration, with the context it was written in. */
function declarationOf(
  item: Extract<BlockItem, { kind: "declaration" }>,
  selector: string,
  conditions: readonly string[],
): AtomicDeclaration {
  const property = propertyName(item.property);
  /** Local to this declaration, so the same declaration anywhere is the same text. See above. */
  const holes: number[] = [];
  let value = "";
  for (const part of item.value) {
    if (part.kind === "text") {
      value += part.text;
      continue;
    }
    value += `${HOLE}${holes.length}${HOLE}`;
    holes.push(part.index);
  }

  const canonical = `${property}:${collapse(value)};`;
  const sorted = mayBeSorted(conditions) ? [...conditions].sort() : [...conditions];

  /**
   * **`!important` IS A DIFFERENT DECLARATION**, and it was the same key as the plain one beside it.
   *
   * A key answers *what does this set*, and two declarations sharing one are the same thing set
   * twice, where the later wins. `!important` breaks that rule: it wins whatever the order.
   * Measured in Chromium against the same CSS by hand —
   * `color: rgb(1,0,0) !important; color: rgb(2,0,0)` gives `rgb(1,0,0)` there and gave `rgb(2,0,0)`
   * here, because the important declaration was dropped from the map and only its unreachable rule
   * reached the stylesheet.
   *
   * With its own key both classes land and **CSS decides**, which is this package's whole premise.
   * That includes the layer REVERSAL `!important` causes, which was measured in the real layer
   * scheme rather than reasoned about: four cases, all agreeing with plain CSS, one across a media
   * query.
   *
   * The spelling is the one `rules.ts` already uses for the same question on a custom property —
   * optional whitespace after the bang, and case-insensitive, because both are valid CSS and a
   * browser reads all of them as importance.
   */
  const important = IMPORTANT.test(value);

  return {
    key: [...sorted, ...(selector === "" ? [] : [selector]), important ? `${property}!` : property].join("|"),
    property,
    canonical,
    // The context first, so two rules differing only in it are visibly different text to hash.
    identity: [...sorted, selector, canonical].join("|"),
    selector,
    conditions: sorted,
    holes,
    at: item.at,
  };
}

const same = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && a.every((one, index) => one === b[index]);

/**
 * What a nested rule appends to its parent's selector.
 *
 * `&:hover` is `:hover` and `& .title` is ` .title` — the `&` is where the parent goes, so what
 * follows it is the suffix. A prelude with no `&` is a DESCENDANT, which is what CSS nesting says a
 * bare selector means inside a rule, so it gets the space CSS would have added.
 */
/**
 * A nested rule's selector inside its parent's.
 *
 * The inner selector names its parent with `&`, and the parent is the outer selector — so this is
 * `withParent` again rather than a concatenation. Concatenation was right only while every selector
 * began with the parent: `.parent &` inside `&:hover` would have joined to `&:hover.parent &`, with
 * two parents and neither where the author put one.
 *
 * At the top there is no outer selector, and the inner one is already written against the element.
 */
function nested(outer: string, inner: string): string {
  return outer === "" ? inner : withParent(inner, outer);
}

/**
 * The at-rules whose NESTING ORDER does not matter, so their conditions may be sorted.
 *
 * A CONDITIONAL at-rule asks a question — `@media A { @supports B { … } }` is "A and B", and `and`
 * commutes — so sorting lets two authors who wrote the same two conditions in either order share
 * one class, which is the whole win of atomic CSS.
 *
 * **A STRUCTURAL at-rule does not ask, it places, and nesting COMPOSES it.** A review measured two:
 * `@layer a { @layer b { … } }` is layer `a.b` while the reverse is `b.a` — two different cascade
 * layers at different priorities, which is exactly what layers are for — and
 * `@scope (.p) { @scope (.q) { … } }` matches an element inside a `.q` inside a `.p` while the
 * reverse matches inside a `.p` inside a `.q`, so on one document one of them matches and the other
 * does not. Sorted, both authors got one rule and one of them silently lost their own.
 *
 * **An ALLOW-LIST, and that is the point.** The justification for sorting measured exactly one pair
 * — `@media` against `@supports` — and every prelude starting with `@` inherited the conclusion. So
 * the unknown case has to fail SAFE: an at-rule CSS invents after this is written keeps the order it
 * was written in, which is never wrong and at worst spends a second class where one would do. A
 * deny-list would silently mis-sort the next structural at-rule instead.
 *
 * `@starting-style` is deliberately absent: it is not a condition either, and nothing here has
 * measured whether its nesting commutes. Absent costs a class; present and wrong costs a rule.
 */
const SORTABLE = new Set(["@media", "@supports", "@container"]);

/**
 * Whether EVERY condition here may be sorted, which is the only form the question takes.
 *
 * Sorting the sortable ones among themselves would move them past a structural one, and that is the
 * thing that may not happen — so a set holding one structural condition keeps its whole order. One
 * rule rather than an argument about each position.
 */
function mayBeSorted(conditions: readonly string[]): boolean {
  return conditions.every((condition) => SORTABLE.has(atRuleName(condition)));
}

/** `@media` out of `@media (min-width: 40rem)` — the name, without whatever follows it. */
function atRuleName(condition: string): string {
  const space = condition.indexOf(" ");
  return space === -1 ? condition : condition.slice(0, space);
}

/**
 * The key a nested rule's prelude stands for, with the parent named explicitly.
 *
 * `div { … }` inside a block means `& div` — a descendant, which is what CSS nesting says a prelude
 * naming no parent means. Written that way rather than left as the author typed it, so a selector
 * is one string wherever it is read.
 *
 * **Exported because the VIRTUAL FILE has to ask the same question.** It wrote the raw prelude as
 * the object key, and `CssBlockShape` admits a nested rule only under a key beginning with `&` or
 * `@` — so `div { color: red; }` was a `TS2353` in the editor while the build compiled and shipped
 * it. The type is right that a bare word is not a property; it was reading a selector the compiler
 * had already decided about.
 */
export function selectorOf(prelude: string): string {
  const written = collapse(prelude);
  return holdsParent(written) ? written : `& ${written}`;
}

/**
 * Whether a prelude names the parent at all, ignoring any `&` inside a string.
 *
 * `&[data-x="a&b"]` names it once; the second `&` is text in an attribute value. Nothing else in a
 * selector can quote, so the two quote characters are the whole scan.
 */
function holdsParent(prelude: string): boolean {
  for (let index = 0; index < prelude.length; index++) {
    const code = prelude.charCodeAt(index);
    if (code === 34 || code === 39) {
      index = endOfSelectorString(prelude, index);
      continue;
    }
    if (code === 38 /* & */) return true;
  }
  return false;
}

/**
 * The selector with every `&` replaced by `self`, which is what makes the emitted rule mean what the
 * author wrote — and what the suffix model could not express.
 *
 * The two share this function because they are one question: `selectorOf` decides where the parent
 * is written and this decides what is written there. It used to be a SUFFIX appended after the class,
 * which is only correct while a prelude names the parent once and at the start. A review measured
 * what else happens: `&:hover, &:focus` emitted `.r-x:hover, &:focus`, and `.parent &` emitted
 * `.r-x .parent &`. In an emitted rule there is no nesting parent, so a surviving `&` behaves as
 * `:scope` — it resolves against the ROOT element, not the styled one — and both were accepted by
 * the checker, so the fault was a wrong stylesheet rather than a refusal.
 */
export function withParent(selector: string, self: string): string {
  // A selector naming no parent is a DESCENDANT of it, which is CSS nesting's own rule for a
  // relative selector with no combinator — `selectorOf` writes the `&` in for that case, and this
  // says the same thing so a hand-built declaration cannot emit a rule with no class in it at all.
  if (!holdsParent(selector)) return `${self} ${selector}`;

  let out = "";

  for (let index = 0; index < selector.length; index++) {
    const code = selector.charCodeAt(index);
    if (code === 34 || code === 39) {
      const closed = endOfSelectorString(selector, index);
      out += selector.slice(index, closed + 1);
      index = closed;
      continue;
    }
    out += code === 38 /* & */ ? self : selector[index];
  }

  return out;
}

/** Past the closing quote, or the last character when a selector's string is never closed. */
function endOfSelectorString(text: string, start: number): number {
  const quote = text.charCodeAt(start);
  for (let index = start + 1; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code === 92 /* \\ */) {
      index++;
      continue;
    }
    if (code === quote) return index;
  }
  return text.length - 1;
}
