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
export type { HoleValues, StyleBlock, StyleValue, StyleVarValue } from "./types";
export { block, toStyleObject } from "./value";
