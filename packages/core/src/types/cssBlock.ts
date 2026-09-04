/**
 * What the `css` prop accepts: a style block that has already been compiled.
 *
 * A block is written in real CSS beside the markup, with `{{expr}}` holes, and compiled before the
 * build into a class that already exists in a stylesheet plus one custom property per hole. By the
 * time a value reaches the framework there is nothing left to parse — a class name, the property
 * names, and this render's values for them.
 *
 * ## Why the shape is declared here rather than imported
 *
 * The compiler is `@ramonda/css`, and **it may not import the framework**, at any depth, not even as
 * a peer — a wrapper putting a `css` prop on another JSX library has to be able to take the value
 * and nothing else. The framework does not depend on it either, so neither package can name the
 * other's type and the shape is declared twice on purpose.
 *
 * Twice is a place to drift, so `scripts/check-css-contract.mjs` reads both declarations and fails
 * the build when they disagree — the same arrangement core and `@ramonda/check` have for the
 * single-use decorators, and for the same reason: the fact is shared, the code is not.
 *
 * The full reasoning is `packages/css/CONTRACT.md`.
 */
export interface CssBlockValue {
  /** The generated class, which the element carries alongside any `className` of its own. */
  readonly className: string;
  /** The custom property names, in hole order. Empty when the block has no holes. */
  readonly properties: readonly string[];
  /**
   * This render's values, parallel to {@link properties}.
   *
   * `undefined` is not one of them, and that is a measured requirement rather than a preference: a
   * hole missing on one side of a hydration boundary and present on the other either goes unreported
   * or is reported and not repaired. The compiler's own types are what refuse it — see
   * `packages/css/DESIGN.md`.
   */
  readonly values: readonly (string | number)[];
}
