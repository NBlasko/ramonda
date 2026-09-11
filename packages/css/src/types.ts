/**
 * The compiled value, which is the whole boundary between this package and whatever renders it.
 *
 * A block never becomes a rule at runtime and never becomes attribute text. It becomes a class that
 * already exists in a stylesheet, plus one custom property per hole — so the only thing that has to
 * cross into the renderer is a class name and a list of name/value pairs.
 */

/**
 * What a hole may evaluate to.
 *
 * `undefined` is absent on purpose and it is not a preference. Measured against a real server render
 * and hydration: a hole that is `undefined` on the server and a value on the client is repaired
 * silently, and a hole that is a value on the server and `undefined` on the client is reported as a
 * divergence and **not** repaired — the stale value survives. Both failing directions are the
 * `undefined` directions, so the signature is what removes them. See DESIGN.md.
 *
 * `number` is here because plenty of properties take one (`opacity`, `z-index`, `flex-grow`), and it
 * is the per-property types — not this — that refuse `padding: 24` where a unit is required.
 */
export type StyleVarValue = string | number;

/** What the `css` prop accepts. Produced by {@link StyleBlock}, never written by hand. */
export interface StyleValue {
  /** The generated class, `r-` plus the hash of the normalised block. */
  readonly className: string;
  /** The custom property names, in hole order. Empty when the block has no holes. */
  readonly properties: readonly string[];
  /** The values, parallel to {@link properties}. Empty on a descriptor that has not been called. */
  readonly values: readonly StyleVarValue[];
}

/**
 * One argument per hole, with the arity taken from the property-name tuple.
 *
 * The compiler writes both halves, so this is the compiler checking itself: emitting two property
 * names and one argument stops being a class of bug that reaches a browser.
 */
export type HoleValues<P extends readonly string[]> = { -readonly [K in keyof P]: StyleVarValue };

/**
 * A block as the compiler hoists it: the descriptor for the block, and the call that fills its holes.
 *
 * It is both because the two cases have different costs. A block with no holes has nothing to fill,
 * so the descriptor IS the value and the site reads `css={_s0}` — one allocation for the life of the
 * program however many elements carry it. A block with holes reads `css={_s0(expr)}` and allocates
 * per element, which is what a per-element value costs.
 */
export type StyleBlock<P extends readonly string[] = readonly string[]> = StyleValue &
  ((...values: HoleValues<P>) => StyleValue);
