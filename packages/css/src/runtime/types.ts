/**
 * The compiled value, which is the whole boundary between this package and whatever renders it.
 *
 * A block never becomes a rule at runtime and never becomes attribute text. It becomes classes that
 * already exist in a stylesheet — so the only thing that crosses into the renderer is a string.
 */

/**
 * The brand on a compiled block: not a field, and not forgeable.
 *
 * A `unique symbol` member on a string type emits nothing and exists at no runtime — the value IS
 * the string. What it buys is that a plain `string` cannot be handed where a block is wanted, and
 * that **concatenation loses it**: `` `${a} ${b}` `` is a `string` and not a block, so the merge
 * cannot be bypassed with `+`.
 */
declare const COMPILED: unique symbol;

/** What the `css` prop and `className` accept. Produced by the compiler, never written by hand. */
export type StyleValue = string & { readonly [COMPILED]: true };
