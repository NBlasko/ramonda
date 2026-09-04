/**
 * A parsed block, which is what normalisation works on rather than the author's text.
 *
 * The distinction is the reason `color : red` and `color:red` share a class. Normalising TEXT can
 * only collapse whitespace it cannot interpret — the space before a `:` in a declaration is
 * meaningless and the space before a `:` in `& :first-child` is a combinator, and nothing that reads
 * characters can tell them apart. Once the block is parsed, the whitespace the author wrote around
 * the colon is not in the structure to begin with.
 *
 * The parser (see PLAN.md, A1) produces this. It is written down here first because everything from
 * the class name to the stylesheet is defined in terms of it, and because it can be implemented and
 * tested — as it is — before any parser exists.
 */

/** One block: an ordered list of items. Order is meaning and is never sorted. */
export interface Block {
  readonly items: readonly BlockItem[];
}

export type BlockItem = Declaration | NestedRule;

/** `border-left: 4px solid {{this.accent}}`. */
export interface Declaration {
  readonly kind: "declaration";
  /**
   * Where the property name starts in the author's file, and where its value does.
   *
   * Provenance, not content: normalisation never reads either, so two blocks written in different
   * files still hash the same. They exist for the virtual file, which has to send a diagnostic about
   * a key or a value back to the character the author typed.
   *
   * Optional because a block built by hand has no source to point at — the parser always sets them.
   */
  readonly at?: number;
  readonly valueAt?: number;
  /**
   * Where the declaration finished in the author's file.
   *
   * Earns three things at once: the length of the value's own text, the boundary an editor's caret
   * has to be inside to belong to this declaration, and the point after which a caret belongs to
   * nothing yet — which is where a virtual file for an editor puts an empty slot.
   */
  readonly end?: number;
  /**
   * The property, as written. Case is folded for a normal property because CSS reads it that way,
   * and kept for a custom property (`--Accent`) because CSS does not.
   */
  readonly property: string;
  /** The value, split wherever a hole interrupts it. */
  readonly value: readonly ValuePart[];
}

/**
 * `&:hover { … }`, `& .title { … }`, `@media (min-width: 40rem) { … }`.
 *
 * The prelude is kept verbatim. A pseudo-class is case-insensitive and a class name is not, so
 * nothing here may fold case — `&.Card` and `&.card` are different selectors.
 */
export interface NestedRule {
  readonly kind: "rule";
  /** Where the prelude starts in the author's file. See {@link Declaration.at}. */
  readonly at?: number;
  /** Where the prelude ENDS — its `{`. See {@link Declaration.end}. */
  readonly preludeEnd?: number;
  readonly prelude: string;
  readonly items: readonly BlockItem[];
}

export type ValuePart = TextPart | HolePart;

export interface TextPart {
  readonly kind: "text";
  /** Where this run of text starts in the author's file. See {@link Declaration.at}. */
  readonly at?: number;
  readonly text: string;
}

/**
 * A carried expression, identified only by its position in the block.
 *
 * What the expression IS never reaches here, and that is the point: two blocks with identical CSS
 * and different expressions are one class and one rule, each element carrying its own value. The
 * expression's own bytes stay in the author's file, which is also what keeps the source map honest.
 */
export interface HolePart {
  readonly kind: "hole";
  /** 0-based, in source order within the block. */
  readonly index: number;
}
