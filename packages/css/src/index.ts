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
export type { HoleValues, StyleBlock, StyleValue, StyleVarValue } from "./types";
export { block, toStyleObject } from "./value";
export type { StyleEntry, StyleMap } from "./merge";
export { compose, merge } from "./merge";
