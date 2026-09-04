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
 * Every CSS property, and what it accepts.
 *
 * **This is a placeholder and it is the whole of track C.** The real map is generated: enumerable
 * properties (`display`, `position`, `flex-direction`, …) become a union so TypeScript's own *did
 * you mean* fires, and lengths, colours and shorthands stay `string | number` because a
 * template-literal union produces an unreadable diagnostic that grows combinatorially. See
 * `PLAN.md`, track C, and `DESIGN.md` for the measurement behind that split.
 *
 * Until then it accepts anything, so a project using the virtual file gets the *structure* checked —
 * the holes, and the shape of the block — and not the property names. The index signature is what
 * turns the name check off, and deleting it is what turns it on.
 */
export interface CssProperties {
  [property: string]: string | number;
}

/**
 * One block, as the virtual file writes it.
 *
 * Three kinds of key, and each index signature is written as a template literal so that a key
 * matching none of them is still an EXCESS property — which is the whole point. A plain
 * `[key: string]` would accept `dsiplay` and there would be nothing left to check.
 *
 * - a property, from {@link CssProperties};
 * - a nested rule, `&:hover` or `& .title`;
 * - an at-rule, `@media (min-width: 40rem)`;
 * - a custom property the author declares themselves, `--brand`.
 */
export type CssBlockShape = Partial<CssProperties> & {
  [nested: `&${string}`]: CssBlockShape;
} & { [at: `@${string}`]: CssBlockShape } & { [custom: `--${string}`]: string | number };
