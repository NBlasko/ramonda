/**
 * `@ramonda/css` — what a page loads.
 *
 * Everything here is the compiled value and nothing else: no parser, no hash, no stylesheet. The
 * build half lives behind `@ramonda/css/compiler` and never reaches a browser.
 *
 * **This package imports nothing.** Not the framework, not at any depth, not as a peer — the same
 * rule `@ramonda/lens` follows, and for the same reason: a wrapper can put a `css` prop on another
 * JSX library without dragging a framework in behind it.
 */
/**
 * The narrow types, for the declaration that MAKES a value rather than for the block.
 *
 * Types only — generated from the same unit table the checker measures a typo against, so the
 * two cannot drift, and nothing here reaches the runtime.
 */
export type {
  CssAngleUnit,
  CssDimension,
  CssFrequencyUnit,
  CssLengthUnit,
  CssResolutionUnit,
  CssTimeUnit,
  CssUnit,
} from "./units.generated";
/** A colour, for the declaration that makes one — see `CssDimension` for the same argument. */
export type { CssColor, CssColorKeyword } from "./values.generated";
/**
 * What `$color.primary.main` IS, for the module codegen writes.
 *
 * A TYPE and nothing else, which is what lets that module import from here without importing
 * anything: a token's runtime value is the string `var(--color-primary-main)`, written straight into
 * the generated file, so there is no factory to call and no code to ship.
 */
/**
 * `CssVar` is what `@@property( … )` binds: the generated name, carrying the kind its `syntax` said.
 *
 * It is published because it is what somebody writes in their own annotation — a function that
 * takes *any angle property this app registered* says so with `CssVar<"angle">`, and `toStyle`
 * refuses a length against it.
 */
export type { CssVar, Fixed, Kind, Token, ValueByKind } from "./token";
export type { StyleValue } from "./types";
/**
 * What a project does with a declared variable OUTSIDE a block.
 *
 * `$` inside a block is compiled away and never reaches the browser. These are the other half: a
 * theme whose values arrive at run time, and the rare read back out. Neither is a theming mechanism
 * — what is owed is the name and the kind check, not the logic.
 */
export { read, toStyle } from "./value";
export type { Setting } from "./value";
/**
 * `shorthands` and `conditionsOf` are called by EMITTED code and by nothing anybody writes.
 *
 * A block is a class string, and two things do not fit in one: what a shorthand clears, and the
 * conditions a hashed key stands for. Each module registers what its own blocks need, so a page
 * pays for the shorthands it writes rather than for a table of all ninety-eight. They are part of
 * the surface because a build imports them by name, which is the same reason `mergeClassNames` and `pick` are.
 */
export { conditionsOf, mergeClassNames, namesOf, pick, shorthands } from "./merge";
/** Called by a development build's emitted code for a spread — see `sources.ts`. */
export { withoutSourceMarks } from "./sources";
