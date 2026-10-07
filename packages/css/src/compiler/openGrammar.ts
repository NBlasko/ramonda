import { type GrammarOf, type SyntaxOf, longhandsFor } from "./classify";
import { type Term, SyntaxNotationError, parseValueSyntax } from "./valueSyntax";

/**
 * Opening a shorthand's grammar until every leaf belongs to a longhand.
 *
 * ## The question this answers
 *
 * A family's published grammar is written in types and says nothing about its longhands.
 * `<single-animation>` is `[ none | <single-animation-timeline> ] || <time> || …`, and the word
 * `animation-name` is nowhere in it. Before a value can be read against that grammar, every part of
 * the grammar has to be told which longhand it feeds — and where a part cannot say, it is OPENED
 * into its own grammar and the question is asked again.
 *
 * ## Why it is here and not in the generator
 *
 * The slot generator and the parser both need this rule, so it lives here once and
 * `scripts/build-grammar-shapes.mjs` reads its LEAVES — see `one-rule-many-consumers`.
 *
 * ## The one thing it does that a flat reading cannot
 *
 * It keeps the tree. `componentsOf` drops a literal, because a list of slots has nowhere to put
 * one; a parse reads it. `mask` is `<bg-position> [ / <bg-size> ]?`, two longhands told apart by a
 * slash, and without the slash `center / cover` and `center cover` are the same three tokens.
 *
 * ## How deep, which is not a list of type names
 *
 * A part is opened when it claims NO longhand, and kept when it claims one. That is the whole rule:
 * `<color>` is kept because a colour longhand claims it, `<single-animation>` is opened because
 * nothing claims it. The caller's `GrammarOf` can still decline to hand over a grammar, which is
 * how the generator keeps `<color>` from expanding into its 192 words — see `acceptedBy`, which
 * stops the same way.
 */

/** One leaf of an opened grammar, with the longhands it feeds. */
export interface OpenedLeaf {
  readonly term: Term;
  readonly longhands: readonly string[];
}

/** An opened grammar: the tree a parse reads, and its leaves in the order the grammar names them. */
export interface Opened {
  readonly tree: Term;
  readonly leaves: readonly OpenedLeaf[];
}

const COMPOSITE = new Set(["alt", "or", "and", "seq"]);

/**
 * How many times a part may be opened before this gives up.
 *
 * The same three the generator uses. A grammar that refers to itself — `<loop>` is `<loop>` — has
 * no other end, and CSS has several of those.
 */
const DEEPEST = 3;

/** The multiplier of the part that was opened, carried onto what came out of it. */
function carrying(from: Term, tree: Term): Term {
  if (from.optional !== true && from.repeat === undefined && from.comma !== true) return tree;
  const free = tree.optional !== true && tree.repeat === undefined && tree.comma !== true;
  const worn = { optional: from.optional, repeat: from.repeat, comma: from.comma };
  // Where the opened grammar carries a multiplier of its own, the two are not merged — the opened
  // tree becomes one part of a sequence and the outer multiplier goes on the sequence.
  return free ? { ...tree, ...worn } : { kind: "seq", terms: [tree], ...worn };
}

/**
 * Open a grammar, or refuse.
 *
 * Refusing means the family has no shape here: some part of it belongs to no longhand and cannot be
 * opened to find one. That is the same answer the generator gives, and it leaves the declaration a
 * shorthand — visibly the author's own text, where a wrong split is invisible.
 */
export function openedFor(
  term: Term,
  longhands: readonly string[],
  grammar: GrammarOf,
  syntax: SyntaxOf,
): Opened | undefined {
  const walk = (one: Term, claimed: readonly string[] | undefined, depth: number): Opened | undefined => {
    // A separator belongs to no longhand and is read by the parse, so it is kept and claims nothing.
    if (one.kind === "literal") return { tree: one, leaves: [] };

    /**
     * Its OWN claim first; the one carried down from a group only where it has none.
     *
     * A group of alternatives claims the union of its branches, and letting that replace a branch's
     * own claim would make every branch feed every longhand the group reaches — `timeline-trigger`
     * would get all five leaves on `timeline-trigger-name`. The carried claim is for the branch
     * that claims nothing by itself, like `<custom-ident>` beside `none`; it is a fallback, not an
     * override.
     */
    const own = longhandsFor(one, longhands, syntax);
    const mine = own.length > 0 ? own : (claimed ?? own);

    if (COMPOSITE.has(one.kind)) {
      /**
       * A group that claims a longhand carries the claim DOWN rather than becoming a leaf.
       *
       * `[ none | <custom-ident> ]` is `animation-name`'s part of `<single-animation>`: it claims
       * the longhand as a whole, and neither `none` nor `<custom-ident>` has a grammar of its own
       * to be opened into. Carrying the claim is what stops it being opened into nothing.
       */
      /**
       * Only a group of ALTERNATIVES carries its claim down, and only to its own branches.
       *
       * `[ none | <custom-ident> ]` is two ways of writing one component. A sequence is different
       * components, and carrying a claim THROUGH one would give `timeline-trigger`'s range leaves
       * the name. So a sequence, `||` or `&&` hands nothing down — each of its components answers
       * for itself — and an alternative's claim stops at the alternative.
       */
      const carry = one.kind === "alt" && mine.length > 0 ? mine : undefined;
      const parts: Term[] = [];
      const found: OpenedLeaf[] = [];
      for (const child of one.terms ?? []) {
        const below = walk(child, carry, depth);
        if (below === undefined) return undefined;
        parts.push(below.tree);
        found.push(...below.leaves);
      }
      return { tree: { ...one, terms: parts }, leaves: found };
    }

    if (mine.length > 0) return { tree: one, leaves: [{ term: one, longhands: mine }] };

    const inner = one.name === undefined || depth >= DEEPEST ? "" : grammar(one.name);
    if (inner === "") return undefined;
    let opened: Term;
    try {
      opened = parseValueSyntax(inner);
    } catch (thrown) {
      /**
       * Only notation this cannot read, which is a part that cannot be opened and so a refusal.
       *
       * Not a bare `catch`: with the depth cap lifted, `<loop>` opening itself overflows the stack
       * INSIDE the parse, and a bare catch would turn that into a refusal — so the case would pass
       * while the cap it was written for did nothing. A cap that can be removed without a test
       * noticing is not a cap.
       */
      if (thrown instanceof SyntaxNotationError) return undefined;
      throw thrown;
    }
    const below = walk(opened, undefined, depth + 1);
    return below === undefined ? undefined : { tree: carrying(one, below.tree), leaves: below.leaves };
  };

  const opened = walk(term, undefined, 0);
  // Nothing to split BY. A grammar of separators alone reaches here with a tree and no leaves, and
  // a shape with no leaves would map every value to no longhand at all.
  return opened === undefined || opened.leaves.length === 0 ? undefined : opened;
}
