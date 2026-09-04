/**
 * `@ramonda/css/compiler` — what a build loads, and what a browser never does.
 *
 * The split is not tidiness. Everything here decides a name, and a name is decided once at build
 * time by definition: a runtime that could hash a block would be a runtime that could invent a rule,
 * and no rule is ever created at runtime — see DESIGN.md, decision 7. Keeping the hash on this side
 * of the boundary is what makes that true by construction rather than by discipline.
 */
export type { Block, BlockItem, Declaration, HolePart, NestedRule, TextPart, ValuePart } from "./ast";
export { HASH_LENGTH, classNameFor, substitute, variableNameFor } from "./names";
export { HOLE, normalise } from "./normalise";
