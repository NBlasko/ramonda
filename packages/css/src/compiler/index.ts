/**
 * `@ramonda/css/compiler` — what a build loads, and what a browser never does.
 *
 * The split is not tidiness. Everything here decides a name, and a name is decided once at build
 * time by definition: a runtime that could hash a block would be a runtime that could invent a rule,
 * and no rule is ever created at runtime — see DESIGN.md, decision 7. Keeping the hash on this side
 * of the boundary is what makes that true by construction rather than by discipline.
 *
 * Two levels are published, because two different things need them. `transform` is the whole job and
 * is what a bundler plugin calls. `findBlocks` and `readBlock` are the parser underneath it, and the
 * virtual-file layer needs exactly those: it produces a DIFFERENT file from the same reading — one
 * TypeScript can check — so it shares the parse and not the emit.
 */
export type { Block, BlockItem, Declaration, HolePart, NestedRule, TextPart, ValuePart } from "./ast";
export { CssBlockError } from "./errors";
export { HASH_LENGTH, classNameFor, substitute, variableNameFor } from "./names";
export { HOLE, normalise } from "./normalise";
export type { ReadBlock, Span } from "./read";
export { readBlock } from "./read";
export type { BlockSite } from "./scan";
export { findBlocks, mayHoldABlock } from "./scan";
export type { EmittedBlock, SourceMap, TransformOptions, TransformResult } from "./transform";
export { transform } from "./transform";
