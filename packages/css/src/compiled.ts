/**
 * `@ramonda/css/compiled` — what the compiler's EMITTED code imports, and nothing an author writes.
 *
 * A block is a class string, and two things do not fit in one: what a shorthand clears, and the
 * conditions a hashed key stands for. Each module registers what its own blocks need, so a page pays
 * for the shorthands it writes rather than for a table of all ninety-eight. `pick` chooses a `match`
 * arm at run time, and `withoutSourceMarks` is what a development build calls for a spread.
 *
 * Its own entry rather than the runtime entry, because there these were a second way to do what a
 * `match` and a block already do, and nothing checks a hand-written call. `mergeClassNames` is the
 * one name both entries export, and it must be ONE function: it reads what `shorthands` registered,
 * so a copy per entry would merge without clearing. The build shares the module between them.
 */
export { conditionsOf, mergeClassNames, namesOf, pick, shorthands } from "./runtime/merge";
export { withoutSourceMarks } from "./runtime/sources";
