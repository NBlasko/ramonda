import type { Block, BlockItem, ValuePart } from "./ast";
import { nameFor } from "./dollar";
import { HOLE, canonicalValue, collapse, propertyName } from "./normalise";
import { MAY_CLEAR, PROPERTIES, SHORTHANDS } from "./keywords.generated";
import { widthSlot } from "../runtime/conditions";
import { SPREAD, branchOf, holeIn } from "./read";
import { IMPORTANT, splitOf } from "./split";

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
   * The class name is the hash of this and not of {@link canonical} alone. `color: red` and
   * `&:hover { color: red }` have the same text and are two different rules — hashed on the text,
   * the sheet kept whichever arrived first and the hover one was emitted with no selector, so it
   * applied always. Across files neither block need know about the other, and the sheet's collision
   * assertion cannot see it either, because the css text really is identical.
   */
  readonly identity: string;
  /** Appended to the class in the selector — `:hover`, ` .title`, `""` for the class alone. */
  readonly selector: string;
  /** The conditional at-rules around it, sorted — see {@link flatten}. */
  readonly conditions: readonly string[];
  /** The BLOCK's hole indices this declaration uses, in the order it uses them. */
  readonly holes: readonly number[];
  /**
   * When this declaration is one ARM of a `match`: what the subject must be for it to apply.
   *
   * Every arm is its own rule with its own class — that is the point of a match, and why it can be
   * a class at all — so flattening one produces several declarations rather than one. They share a
   * `key`, because they are one thing set one way, and the emit turns a run of them into a single
   * entry that chooses between the classes. See `MatchPart`.
   */
  readonly arm?: { readonly hole: number; readonly is: string; readonly otherwise: boolean };
  /**
   * When this declaration is one BRANCH of a choice — `$(a) ? x : $(b) ? y : z`: which choice (its
   * first condition's hole), which branch, and every condition in order. The last branch, the one
   * after the final `:`, is `branch === holes.length`. See `ChoicePart`.
   */
  readonly choice?: { readonly id: number; readonly branch: number; readonly holes: readonly number[] };
  /**
   * Whether the value ends in `!important`, which MIRRORS the layer it goes in.
   *
   * CSS reverses layer order for important declarations: among them the layer declared FIRST wins.
   * So an important rule kept in its ordinary layer comes out backwards — measured in all three
   * engines, `background: red !important; background-color: blue !important` gave red where the
   * same two lines in one hand-written rule give blue. See {@link layerPathFor}.
   */
  readonly important?: boolean;
  /** Where it was written, so a finding lands on it. */
  readonly at?: number;
  /**
   * The shorthand a SPLIT produced this from, when one did.
   *
   * It decides the layer and nothing else: a `padding-left` the compiler derived from `padding` is
   * weaker than one an author typed, so a written longhand wins even where the two never meet in a
   * merge — which is the one place the merge cannot answer. See {@link layerPathFor}.
   */
  readonly from?: string;
}

/**
 * The distinct breadths a property can have, WIDEST first — the sheet's minor order.
 *
 * From the generated shorthand table, so it is known before a build — one for each distinct number
 * of properties a shorthand clears, and the count moves with the table rather than being written
 * here. `all` covers the most and comes first; a longhand covers none and comes last.
 */
const BREADTHS: readonly number[] = (() => {
  const found = new Set<number>([0]);
  for (const covered of Object.values(SHORTHANDS)) found.add(covered.length);
  return [...found].sort((a, b) => b - a);
})();

/**
 * The standard property a VENDOR-PREFIXED one is another name for, or nothing.
 *
 * By stripping the prefix and asking whether what is left is a property CSS has. A prefixed name
 * with no standard form — `-moz-osx-font-smoothing`, `-webkit-box-orient` — is nobody's alias and
 * is left exactly where it was.
 *
 * Deliberately not a generated table. The question here is only *do these two fight*, and being
 * wrong about a pair that does not is harmless: two properties that never touch the same computed
 * value are not affected by which of them is written out first.
 */
export function standardFormOf(property: string): string | undefined {
  const bare = /^-[a-z]+-(.+)$/.exec(property)?.[1];
  return bare !== undefined && STANDARD.has(bare) ? bare : undefined;
}

const STANDARD = new Set(PROPERTIES);

/**
 * How many properties a declaration's own property clears.
 *
 * A prefixed name borrows its standard form's breadth, because the engine gives it the standard
 * property's meaning: `-webkit-border-radius` clears the same four corners `border-radius` does,
 * and the table, which is generated from unprefixed names, said it cleared nothing — so it sat in
 * the longhands' own layer and lost to them.
 */
function breadthOf(declaration: { property?: string }): number {
  const property = declaration.property;
  if (property === undefined) return 0;
  const covered = SHORTHANDS[property] ?? SHORTHANDS[standardFormOf(property) ?? ""];
  return covered?.length ?? 0;
}

export { exclusive, widthSlot } from "../runtime/conditions";

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
  /**
   * The PREFIXED half of an alias pair goes first, so the standard property wins wherever both are
   * written — and, more to the point, wins DETERMINISTICALLY.
   *
   * Both clear the same properties, so both have the same breadth and the same layer; inside a
   * layer the sort is stable, so without this the winner is whichever the build emitted first.
   * Measured in Chromium through a real Vite build, `-webkit-box-shadow: 0 0 1px red; box-shadow: 0
   * 0 9px blue;` rendered blue alone in its file and RED after another block naming `box-shadow`
   * first — the page depended on what another component wrote.
   *
   * A prefix losing to the standard property is also the way round every author means it — the
   * prefixed form is the fallback. And nothing that can read this stylesheet needs one: it is built
   * on `@layer`, and every engine with cascade layers has the unprefixed `transform`, `box-shadow`,
   * `user-select` and `appearance`.
   */
  const prefixed = declaration.property !== undefined && standardFormOf(declaration.property) !== undefined;
  return widthSlot(declaration.conditions) * 100 + BREADTHS.indexOf(breadthOf(declaration)) * 2 + (prefixed ? 0 : 1);
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

/**
 * `all`, the weakest layer of all.
 *
 * It covers every property, so it is weaker than every other shorthand by definition, and one
 * fixed name says that exactly.
 */
const EVERYTHING = "a";

/**
 * The PIECES of a split: weaker than a `padding-left` an author typed, stronger than a shorthand
 * that reaches the sheet whole.
 *
 * ONE name, and no room beside it. A layer name cannot be added later — a stylesheet built before
 * it does not list it, and CSS appends an unseen name to the END, the strongest position — so
 * reserving names for pieces of pieces would be tempting. It is not needed: a split always reaches
 * LEAVES, and `grammarShapes.test.ts` asserts it for every family, the hand-split ones included.
 * That test failing is the answer to such a CSS, not a reserve: the fix is to split further, down
 * to the leaves.
 *
 * Not `d`: the digit levels under `c` are `d0`…`d9`, and one letter for two things would leave a
 * reader of the output unable to tell them apart.
 */
const PIECES = "p";

/**
 * A shorthand that reaches the sheet WHOLE — one that does not split: a `var()`, whose parts are
 * unknown until the page computes them, or a value a split refuses, like `font: caption`.
 *
 * One WORD, not the COUNT of longhands it covers. A count moves when CSS adds a longhand to the
 * family, a package built before that names the old count, and two releases then disagree about
 * which rule is stronger. A word means the same in every release. It sits below the split pieces
 * and the written longhands, which beat it — as a longhand written after its shorthand does in CSS
 * — and above `all`. Measured in all three engines, through the merge, against the same lines
 * written by hand.
 *
 * What a word cannot do is order two of these against each other — `border: var(--x)` and then
 * `border-top: var(--y)`. That is refused instead: see `narrower-after-a-whole-shorthand` in the
 * rules.
 */
const WHOLE = "v";

/**
 * Where a declaration's rule goes, as a layer path.
 *
 * ```
 * a longhand, unconditional      u                every longhand is equally narrow, so one name
 * a split's piece                p                weaker than a longhand an author wrote
 * a shorthand that stays whole   v                weaker than every longhand
 * `all`                          a                weaker than every shorthand there can be
 * anything conditional           c.d0.d5.…  + the same last step
 * ```
 *
 * **Every longhand shares one layer, and that is what splitting buys.** Names that index the table
 * of distinct breadths would move whenever CSS adds a property — `padding` from `u09` to `u10` —
 * and two stylesheets built a year apart would disagree about which layer `padding` is in. After
 * splitting there is no wide unconditional declaration left to separate: every one is a longhand,
 * every longhand is equally narrow, and a name that is the same for everybody separates nobody.
 *
 * And every shorthand splits, so a shorthand reaches the sheet whole only for a value that cannot
 * split. Every name is a word; none is a count.
 */
export function layerPathFor(declaration: {
  property?: string;
  conditions?: readonly string[];
  from?: string;
  important?: boolean;
}): string[] {
  const step =
    declaration.from !== undefined
      ? PIECES
      : breadthOf(declaration) === 0
        ? "u"
        : declaration.property === "all"
          ? EVERYTHING
          : WHOLE;
  const slot = widthSlot(declaration.conditions);
  const path =
    slot === 0
      ? [step]
      : [
          "c",
          ...String(slot)
            .padStart(5, "0")
            .split("")
            .map((digit) => `d${digit}`),
          step,
        ];

  /**
   * An IMPORTANT declaration goes under {@link IMPORTANT_LAYER}, whose every level is declared in
   * the REVERSE order.
   *
   * CSS reverses layer order for important declarations — among them the layer declared FIRST wins
   * — so a rule left in its ordinary layer comes out backwards. Measured in all three engines, on
   * the ordinary path with no package and no joining: `background: red !important;
   * background-color: blue !important` gave red, where the same two lines in one hand-written rule
   * give blue. Every boundary was affected, a shorthand against its longhand, `all` against a
   * shorthand, a `@media` against an unconditional rule, and two breakpoints against each other.
   *
   * Mirroring costs one more name at the top and the reversed lists below it — about 35 gzipped
   * bytes on a real stylesheet, because the repetition compresses.
   */
  return declaration.important === true ? [IMPORTANT_LAYER, ...path] : path;
}

/**
 * The one layer every important declaration sits under, and its levels read backwards.
 *
 * Where it sits among the others does not matter: importance beats non-importance whatever the
 * layer, so nothing normal is ever compared with anything under here.
 */
export const IMPORTANT_LAYER = "i";

/** The names one level of the digit path may hold, in order. */
export const DIGIT_LAYERS: readonly string[] = [...Array(10).keys()].map((one) => `d${one}`);

/**
 * Every name a step may hold, weakest first — four WORDS, and the whole of them. A name cannot be
 * added later (CSS appends an unseen one to the END, the strongest position), so this list is a
 * promise; that is why every name on it is one that does not depend on the shorthand table.
 */
export const BREADTH_LAYERS: readonly string[] = [EVERYTHING, WHOLE, PIECES, "u"];

/**
 * The statement every stylesheet begins with, and it lists the WHOLE range.
 *
 * Not caution. Measured: a stylesheet declaring only the layers it uses put a shorthand's layer
 * AFTER a longhand's, because a file holding just `margin-left` loaded first and CSS appends an
 * unseen name to the END of the order — `margin-left: 4px` became `0px`. Every name a later release
 * might use has to be in the statement an earlier release already emitted, or the two disagree.
 */
export const LAYER_ORDER = `@layer ${[
  `ramonda.${IMPORTANT_LAYER}`,
  ...BREADTH_LAYERS.map((one) => `ramonda.${one}`),
  "ramonda.c",
].join(",")};`;

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

/**
 * Whether two names are the SAME property to the engine — a vendor prefix and its standard form.
 *
 * Kept out of {@link covers} on purpose. `covers` is what the merge clears by, and clearing here
 * would drop one of the pair from the element entirely; an alias is a fallback somebody wrote on
 * purpose, and the two names are not interchangeable in every engine. They fight, and that is all
 * this says.
 */
function alias(a: string, b: string): boolean {
  return standardFormOf(a) === b || standardFormOf(b) === a;
}

/** Whether two properties fight over anything — the same one, one covering the other, or an alias. */
export function conflict(a: string, b: string): boolean {
  return a === b || alias(a, b) || covers(a, b) || covers(b, a) || mayCover(a, b) || mayCover(b, a);
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
 * A hole's index belongs to the BLOCK, so `color: $(x)` is hole 0 alone and hole 1 under another
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
 * block's map, and the guards are the conditions of the `when` groups it sits inside.
 *
 * **Nesting is a conjunction**, which is why the guards are a flat list rather than a tree. That is
 * only correct because the merge is associative, which was measured over 50,301 random groupings
 * drawn from one shorthand family: zero disagreements between a nested merge and a flat one.
 */
/**
 * One condition a segment sits under.
 *
 * A `when` alone is its hole. A BRANCH of a chain — `when … else when … else …` — also says which
 * chain and which arm, because the chain compiles to one conditional expression and every arm is
 * one of its operands: the emit needs to know where one arm ends and the next begins, and whether
 * the chain has a final `else`. A final `else` has no hole of its own.
 */
export interface Guard {
  readonly hole?: number;
  readonly chain?: {
    /** The first arm's hole, which names the chain: one per chain, and in source order. */
    readonly id: number;
    readonly arm: number;
    /** Whether this is the chain's last arm. */
    readonly last: boolean;
    /** Whether the chain ends in a bare `else`. */
    readonly otherwise: boolean;
  };
}

export const sameGuard = (a: Guard | undefined, b: Guard | undefined): boolean =>
  a !== undefined &&
  b !== undefined &&
  a.hole === b.hole &&
  a.chain?.id === b.chain?.id &&
  a.chain?.arm === b.chain?.arm;

export type AtomicSegment =
  | { readonly kind: "declarations"; readonly guards: readonly Guard[]; readonly items: AtomicDeclaration[] }
  | {
      /** A block-level match: one lookup by the subject's hole, and what each arm applies. */
      readonly kind: "match";
      readonly guards: readonly Guard[];
      readonly hole: number;
      readonly arms: readonly {
        readonly key: string;
        readonly otherwise: boolean;
        readonly items: readonly AtomicDeclaration[];
      }[];
    }
  | {
      readonly kind: "spread";
      readonly guards: readonly Guard[];
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
 * `!important`, however it is spelt — the same pattern the rules match for a custom property's
 * value, because it is the same question asked of the same text.
 */

export function flatten(block: Block): AtomicDeclaration[] {
  return segments(block).flatMap((one) =>
    one.kind === "declarations" ? one.items : one.kind === "match" ? one.arms.flatMap((arm) => arm.items) : [],
  );
}

/**
 * A block as the arguments of one merge, in the order the author wrote them.
 *
 * `flatten` answers *what does this set*; this answers *how is it composed*. Two functions because
 * most of the package only needs the first — the rules, the sheet and the checker all ask what a
 * block sets and never how it was assembled.
 *
 * ## `split`, and why only the sheet asks for it
 *
 * A shorthand reaches the STYLESHEET as its longhands, so that no two classes on an element ever set
 * the same property. It must not reach the CHECKER that way. The checker reports at the author's own
 * line and names the property in its message, and after a split the property is one the author never
 * wrote: `display: block; gap: 12px` would be reported as two findings about `row-gap` and
 * `column-gap`, on a line that says `gap`. So the split is the emit path's, and off by default.
 */
export function segments(block: Block, options?: { readonly split?: boolean }): AtomicSegment[] {
  const out: AtomicSegment[] = [];
  walk(block.items, "", [], [], out, options?.split === true);
  return out;
}

function walk(
  items: readonly BlockItem[],
  selector: string,
  conditions: readonly string[],
  guards: readonly Guard[],
  out: AtomicSegment[],
  split: boolean,
): void {
  /** The run being built, so declarations under one guard are one map rather than one each. */
  const run = (): AtomicDeclaration[] => {
    const last = out[out.length - 1];
    if (last?.kind === "declarations" && same(last.guards, guards)) return last.items;
    const fresh: AtomicDeclaration[] = [];
    out.push({ kind: "declarations", guards: [...guards], items: fresh });
    return fresh;
  };

  /** A group's items under one more guard — and, when it produced nothing, its guard alone. */
  const group = (inside: readonly BlockItem[], guard: Guard): void => {
    const before = out.length;
    walk(inside, selector, conditions, [...guards, guard], out, split);
    // Why an empty group still emits its guard is written out below, at the `when` alone.
    if (out.length === before) out.push({ kind: "declarations", guards: [...guards, guard], items: [] });
  };

  for (let at = 0; at < items.length; at++) {
    const item = items[at];

    /**
     * A BLOCK match is a segment of its own: one lookup by the subject, and every arm's declarations
     * as the classes that arm picks — EVERY arm, an empty one too, because an arm with nothing in it
     * still answers for its key, and leaving it out would hand that key to `_`. An arm holds no
     * composition (the reader refuses it), so its items are declarations under no guard of their own.
     */
    if (item.kind === "match") {
      const arms = item.arms.map((one) => {
        const inside: AtomicSegment[] = [];
        walk(one.items, selector, conditions, [], inside, split);
        return {
          key: one.key,
          otherwise: one.otherwise,
          items: inside.flatMap((piece) => (piece.kind === "declarations" ? piece.items : [])),
        };
      });
      out.push({ kind: "match", guards: [...guards], hole: item.hole, arms });
      continue;
    }

    if (item.kind === "rule") {
      const branch = branchOf(item.prelude);

      /**
       * A CHAIN — a `when` and the `else when` and `else` right after it — is one choice, and each
       * arm is a guard that names the chain and its place in it. The reader has already refused an
       * `else` anywhere else, so what follows a `when` here is its chain.
       */
      const chain: { item: (typeof items)[number] & { kind: "rule" }; hole?: number }[] = [];
      if (branch?.kind === "when") {
        chain.push({ item, hole: branch.hole });
        for (let next = at + 1; next < items.length; next++) {
          const following = items[next];
          if (following.kind !== "rule") break;
          const more = branchOf(following.prelude);
          if (more === undefined || more.kind === "when") break;
          chain.push({ item: following, hole: more.kind === "else when" ? more.hole : undefined });
          if (more.kind === "else") break;
        }
      }
      if (chain.length > 1) {
        const id = chain[0].hole ?? 0;
        const otherwise = chain[chain.length - 1].hole === undefined;
        chain.forEach((arm, index) =>
          group(arm.item.items, {
            hole: arm.hole,
            chain: { id, arm: index, last: index === chain.length - 1, otherwise },
          }),
        );
        at += chain.length - 1;
        continue;
      }

      // A branch on its own reaches here only from a forgiving read: its condition, if it has one,
      // guards it as a `when` would, and a bare `else` guards nothing.
      if (branch?.kind === "else") {
        walk(item.items, selector, conditions, guards, out, split);
        continue;
      }

      const condition = branch?.hole;
      if (condition !== undefined) {
        const before = out.length;
        walk(item.items, selector, conditions, [...guards, { hole: condition }], out, split);
        /**
         * A group that produced NOTHING still emits its guard, as an empty run.
         *
         * `@media print { }` is legal CSS that does nothing, so `when $(x) { }` is legal here that
         * does nothing — and commenting a group's body out is how somebody reaches it. But the
         * emission counts on one segment per recorded hole: `readBlock` records the condition's
         * `{expr}` whatever the group holds, and without this the guard has a hole and no segment,
         * so every following piece of text slides one place left. Measured without it: `when
         * $(variant) { }` alone compiled to `_merge(variant)`, which ships `class="l g"` for
         * `variant = "lg"` — two class names that never existed.
         *
         * An empty run contributes no declaration, so the guard is evaluated and applies nothing,
         * which is what the browser does with the empty at-rule this mirrors.
         */
        if (out.length === before)
          out.push({ kind: "declarations", guards: [...guards, { hole: condition }], items: [] });
        continue;
      }
      if (item.prelude.trimStart().startsWith("@")) {
        walk(item.items, selector, [...conditions, collapse(item.prelude)], guards, out, split);
        continue;
      }
      walk(item.items, nested(selector, selectorOf(item.prelude)), conditions, guards, out, split);
      continue;
    }

    const spread = holeIn(item.property, SPREAD);
    if (spread !== undefined) {
      out.push({ kind: "spread", guards: [...guards], hole: spread, selector, conditions, at: item.at });
      continue;
    }

    run().push(...declarationsOf(item, selector, conditions, split));
  }
}

/**
 * A declaration as it reaches the sheet — SEVERAL of them when its value is a `match`.
 *
 * One arm is one rule and one class, which is what lets a match be chosen between at run time
 * without anything being built there. They come back in the order they were written, because a `_`
 * written above a key answers for it and the emit relies on the later arm winning.
 */
function declarationsOf(
  item: Extract<BlockItem, { kind: "declaration" }>,
  selector: string,
  conditions: readonly string[],
  split: boolean,
): AtomicDeclaration[] {
  /**
   * A CHOICE: every branch is its own rule, as a match arm is, each marked with its place so the emit
   * writes one conditional expression that picks between their classes.
   */
  const chosen = item.value.find((part) => part.kind === "choice");
  if (chosen !== undefined && chosen.kind === "choice") {
    const holes = chosen.branches.map((one) => one.hole);
    const values = [...chosen.branches.map((one) => one.value), chosen.otherwise];
    return values.flatMap((one, branch) =>
      maybeSplit(item, one, selector, conditions, undefined, split).map((piece) => ({
        ...piece,
        choice: { id: holes[0] ?? 0, branch, holes },
      })),
    );
  }

  const found = item.value.find((part) => part.kind === "match");
  if (found !== undefined && found.kind === "match") {
    return found.arms.flatMap((one) =>
      maybeSplit(
        item,
        one.value,
        selector,
        conditions,
        { hole: found.hole, is: one.key, otherwise: one.otherwise },
        split,
      ),
    );
  }
  return maybeSplit(item, item.value, selector, conditions, undefined, split);
}

/**
 * One declaration, or the longhands it really sets.
 *
 * A shorthand reaches the sheet as its longhands wherever a measured table can say what they are,
 * because then no two classes on an element ever set the same property and the cascade is never
 * asked to choose. `splitOf` refuses whatever it cannot answer, and a refusal is one declaration,
 * unchanged.
 *
 * **A HOLE is the refusal this file has to make itself.** `padding: ${gap}` is a value that does not
 * exist yet — a custom property filled on the element at run time — and at this point it is a marker
 * in the text rather than a `var()`, so the splitter's own guard does not see it. Split anyway and
 * `padding: ${gap}` becomes four longhands each holding the whole marker, which is four wrong
 * declarations built out of a value nobody has read.
 */
function maybeSplit(
  item: Extract<BlockItem, { kind: "declaration" }>,
  value$: readonly ValuePart[],
  selector: string,
  conditions: readonly string[],
  arm: AtomicDeclaration["arm"],
  split: boolean,
): AtomicDeclaration[] {
  const whole = built(item, value$, selector, conditions, arm);
  if (!split || whole.holes.length > 0) return [whole];
  /**
   * A `match` ARM splits like anything else, and every piece carries the arm it came from — the
   * emit groups them back into ONE string of classes per arm, which `pick` returns and the merge
   * splits on its spaces.
   */
  const longhands = splitOf(whole.property, valueOf(whole.canonical));
  if (longhands === undefined) return [whole];

  return Object.entries(longhands).map(([property, value]) => ({
    ...built(item, [{ kind: "text", text: value }], selector, conditions, arm, property),
    from: whole.property,
  }));
}

/** The value out of a `property:value;` — the canonical text, which is what was split. */
function valueOf(canonical: string): string {
  return canonical.slice(canonical.indexOf(":") + 1, -1);
}

function built(
  item: Extract<BlockItem, { kind: "declaration" }>,
  value$: readonly ValuePart[],
  selector: string,
  conditions: readonly string[],
  arm: AtomicDeclaration["arm"],
  /** Set only by a split: the longhand this piece sets, in place of the shorthand that was written. */
  instead?: string,
): AtomicDeclaration {
  const property = instead ?? propertyName(item.property);
  /** Local to this declaration, so the same declaration anywhere is the same text. See above. */
  const holes: number[] = [];
  let value = "";
  for (const part of value$) {
    if (part.kind === "match") continue;
    if (part.kind === "text") {
      value += part.text;
      continue;
    }
    /**
     * A declared variable is TEXT here, and is emphatically not a hole.
     *
     * A hole becomes a value on the element — a custom property, 41 bytes each, and a render when it
     * changes. `$` costs neither: it is a `var()` in the stylesheet, so two elements written the same
     * way share one class and carry nothing. That difference is the whole reason the spelling exists.
     */
    if (part.kind === "variable") {
      value += `var(${nameFor(part.path)})`;
      continue;
    }
    // A choice never reaches here: `declarationsOf` hands each of its branches over alone.
    if (part.kind === "choice") continue;
    value += `${HOLE}${holes.length}${HOLE}`;
    holes.push(part.index);
  }

  /**
   * The value's KEYWORD CASE is folded here too, because the class name is built from this.
   *
   * The same fold `normalise.ts` applies, or one value gets two classes: unfolded, `color:
   * currentColor` and `color: currentcolor` came out of the real transform as `r-c-currentColor`
   * and `r-c-currentcolor` — identical CSS, two hashes, because `identity` below is built from this
   * string.
   *
   * `canonicalValue` folds a word only where the fold names a keyword the property HAS, so a font
   * family, a custom property's value and a grid-area name keep the case the author gave them —
   * asserted, because folding those would make two different values one class.
   */
  const canonical = `${property}:${canonicalValue(property, collapse(value))};`;
  const sorted = mayBeSorted(conditions) ? [...conditions].sort() : [...conditions];

  /**
   * **`!important` IS A DIFFERENT DECLARATION**, with a key of its own.
   *
   * A key answers *what does this set*, and two declarations sharing one are the same thing set
   * twice, where the later wins. `!important` breaks that rule: it wins whatever the order.
   * Measured in Chromium against the same CSS by hand, `color: rgb(1,0,0) !important; color:
   * rgb(2,0,0)` gives `rgb(1,0,0)`; sharing a key, the important declaration was dropped from the
   * map and this gave `rgb(2,0,0)`. With its own key both classes land and **CSS decides**, which
   * is this package's whole premise.
   *
   * The layer REVERSAL CSS applies to important declarations is answered separately: an important
   * declaration goes under a MIRROR whose levels are declared backwards — see {@link layerPathFor}.
   * A split against a written longhand would agree even without it, because splitting gives them
   * one key and the merge settles them before a layer is asked; every pair across a layer boundary
   * would not.
   *
   * The spelling is the one the rules already use for the same question on a custom property —
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
    arm,
    important,
    at: item.at,
  };
}

const same = (a: readonly Guard[], b: readonly Guard[]) =>
  a.length === b.length && a.every((one, index) => sameGuard(one, b[index]));

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
 * **A STRUCTURAL at-rule does not ask, it places, and nesting COMPOSES it.** `@layer a { @layer b {
 * … } }` is layer `a.b` while the reverse is `b.a` — two different cascade layers at different
 * priorities — and `@scope (.p) { @scope (.q) { … } }` matches an element inside a `.q` inside a
 * `.p` while the reverse matches inside a `.p` inside a `.q`. Sorted, both authors would get one
 * rule and one of them would silently lose their own.
 *
 * **An ALLOW-LIST, and that is the point.** Only `@media` against `@supports` was measured to
 * commute, so the unknown case has to fail SAFE: an at-rule CSS invents after this is written keeps
 * the order it was written in, which is never wrong and at worst spends a second class where one
 * would do. A deny-list would silently mis-sort the next structural at-rule instead.
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
 * **Exported because the VIRTUAL FILE has to ask the same question.** `CssBlockShape` admits a
 * nested rule only under a key beginning with `&` or `@`, so a raw prelude as the object key makes
 * `div { color: red; }` a `TS2353` in the editor while the build compiles and ships it.
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
 * The selector with every `&` replaced by `self`, which is what makes the emitted rule mean what
 * the author wrote.
 *
 * `selectorOf` decides where the parent is written and this decides what is written there, so they
 * are one question. A SUFFIX appended after the class is only correct while a prelude names the
 * parent once and at the start: as a suffix, `&:hover, &:focus` emits `.r-x:hover, &:focus`, and
 * `.parent &` emits `.r-x .parent &`. In an emitted rule there is no nesting parent, so a surviving
 * `&` behaves as `:scope` — it resolves against the ROOT element, not the styled one — and the
 * result is a wrong stylesheet rather than a refusal.
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
