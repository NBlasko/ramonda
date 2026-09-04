/**
 * `@ramonda/css/compiler` — what a build loads, and what a browser never does.
 *
 * The split is not tidiness. Everything here decides a name, and a name is decided once at build
 * time by definition: a runtime that could hash a block would be a runtime that could invent a rule,
 * and no rule is ever created at runtime — see DESIGN.md, decision 7. Keeping the hash on this side
 * of the boundary is what makes that true by construction rather than by discipline.
 *
 * Two emitters over one parse, and that is the whole architecture. `transform` produces the file a
 * bundler runs; `virtualFile` produces the file `tsc` checks. They share `findBlocks` and
 * `readBlock` and nothing else, because a second reading of the syntax would be a second answer to
 * what a file means.
 */
export type { Block, BlockItem, Declaration, HolePart, NestedRule, TextPart, ValuePart } from "./ast";
export { CssBlockError, positionOf } from "./errors";
export { HASH_LENGTH, classNameFor, substitute, variableNameFor } from "./names";
export { HOLE, normalise } from "./normalise";
export type { ReadBlock, Span } from "./read";
export { readBlock } from "./read";
export type { BlockSite } from "./scan";
export { findBlocks, mayHoldABlock } from "./scan";
export type { EmittedBlock, SourceMap, TransformOptions, TransformResult } from "./transform";
export { transform } from "./transform";
export type { VirtualFile, VirtualFileOptions } from "./virtual";
export { virtualFile } from "./virtual";
