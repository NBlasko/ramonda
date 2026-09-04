/**
 * `@ramonda/css/properties` — the type a block is checked against.
 *
 * Nothing imports this at runtime and nothing here has a value. It exists so the **virtual file**
 * can name one type: every block in a project becomes an object literal typed `CssBlockShape`, and
 * an object literal is what gets excess-property checking — which is how a CSS property name gets
 * TypeScript's own *did you mean*, in a syntax TypeScript cannot parse.
 *
 * Measured, exactly these diagnostics, on exactly this shape:
 *
 * | written | reported |
 * |---|---|
 * | `display: flexx` | `TS2820 … Did you mean '"flex"'?` |
 * | `dsiplay: flex` | `TS2561 … Did you mean to write 'display'?` |
 * | `padding: {{nekaFunc()}}` | `TS2322`, against `padding`'s own type |
 * | `&:hover { colr: … }` | `TS2561`, **inside the nested rule** |
 */

/**
 * Every CSS property, and what it accepts — generated from MDN's own data.
 *
 * 551 properties, **123 of them a closed keyword set**. The rest are `string | number`, and their
 * typos belong to the CSS checker, where the message is one we write. The split is measured, not
 * chosen: a template literal type does catch `padding: 10pxx`, and says so in a union that grows
 * combinatorially with every shorthand position.
 *
 * **`display` is not one of the 123**, and the design used to say it was. Its grammar allows
 * `inline flow-root`, so a union of its single keywords would reject valid CSS — and rejecting valid
 * CSS is the one failure a type map may not have. The line this holds is: a union only where the
 * grammar is genuinely closed.
 *
 * Regenerate with `node scripts/build-css-properties.mjs`; `pnpm check` runs it with `--check`.
 */
export type { CssGlobal, CssProperties, CssValue, Keyword } from "./properties.generated";

import type { CssProperties, CssValue } from "./properties.generated";

/**
 * One declaration, as the virtual file writes it.
 *
 * Four kinds of key, and each index signature is written as a template literal so that a key
 * matching none of them is still an EXCESS property — which is the whole point. A plain
 * `[key: string]` would accept `dsiplay` and there would be nothing left to check.
 *
 * - a property, from {@link CssProperties};
 * - a nested rule, `&:hover` or `& .title`, holding declarations of its own;
 * - an at-rule, `@media (min-width: 40rem)`, the same;
 * - anything starting with `-`: a custom property the author declares (`--brand`), and every
 *   vendor-prefixed name (`-webkit-line-clamp`). A hundred prefixed names are in MDN's data and more
 *   are not; one signature accepts all of them, and costs nothing that matters, because a key NOT
 *   starting with `-` still has to be a real property.
 *
 * **A nested rule holds an ARRAY, and a block is an array, and that is not a detail.** TypeScript
 * reports one failure per object literal and stops — so a block written as a single literal with
 * three faults in it reports one of them, and the author fixes it, re-runs, and meets the next.
 * Measured, exactly that. One literal per declaration, gathered in an array, gets every fault
 * reported at once, each with its own position and its own suggestion.
 */
export type CssBlockShape = Partial<CssProperties> & {
  [nested: `&${string}`]: CssBlockShape[];
} & { [at: `@${string}`]: CssBlockShape[] } & { [dashed: `-${string}`]: CssValue };
