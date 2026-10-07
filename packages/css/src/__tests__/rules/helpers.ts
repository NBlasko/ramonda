import { type Finding, checkBlock, checkText } from "../../compiler/rules";
import { findBlocks } from "../../compiler/scan";
import { readBlock } from "../../compiler/read";

/**
 * The CSS checker: the faults the types deliberately cannot catch.
 *
 * ## What is left to it, measured rather than assumed
 *
 * Every candidate fault was put through the real type check first, so no rule here repeats one:
 *
 * | written | the types |
 * |---|---|
 * | `dsiplay: flex` | `TS2561`, **with** *did you mean* |
 * | `flex-dirction: row` | `TS2353`, **no suggestion** — a quoted key gets none |
 * | `position: statik` | `TS2820`, with *did you mean* |
 * | `display: flexx` | **silent** — an open grammar has no union |
 * | `border-left: 4px sollid red` | **silent** |
 * | `color: red; color: red` | **silent** |
 * | `padding: 10pxx` | **silent** |
 *
 * So this owns the near miss for a DASHED property name, and any bare word a property does not
 * accept. A unit typo stays open — see the note on that at the end.
 *
 * ## The method
 *
 * Plant the shape, then measure. Every case below that asserts SILENCE is one that would otherwise
 * be a report on correct CSS, which is how a checker earns being switched off.
 */

/** The findings for one block's text, which is how a person reads a rule's claim. */
export function check(css: string): Finding[] {
  const source = `<div className={@@(\n${css}\n)}>x</div>`;
  const [site] = findBlocks(source);
  const read = readBlock(source, site.open, "Card.tsx", { tolerant: true });
  // Both halves, the way the real callers ask: the parse for what a declaration says, the text for
  // what the parser has no name for.
  return [...checkText(source, site.open, read.end), ...checkBlock(read.block)].sort((a, b) => a.at - b.at);
}

export const rules = (css: string) => check(css).map((finding) => finding.rule);

export const messages = (css: string) => check(css).map((finding) => finding.message);

/** The rule ids for one block, checked with a project config — for the config-driven rules. */
export function rulesWith(css: string, config: import("../../config/config").Config): string[] {
  const source = `<div className={@@(\n${css}\n)}>x</div>`;
  const [site] = findBlocks(source);
  const read = readBlock(source, site.open, "Card.tsx", { tolerant: true });
  return checkBlock(read.block, { config }).map((finding) => finding.rule);
}

/** The same, as messages — for the rules whose WORDING is the thing being asserted. */
export function messagesWith(css: string, config: import("../../config/config").Config): string[] {
  const source = `<div className={@@(\n${css}\n)}>x</div>`;
  const [site] = findBlocks(source);
  const read = readBlock(source, site.open, "Card.tsx", { tolerant: true });
  return checkBlock(read.block, { config }).map((finding) => finding.message);
}

/**
 * A named site's body, where the vocabulary is not the properties.
 *
 * The types own most of this and the split is deliberate: a descriptor that does not exist, or one
 * that is missing, is a type error with TypeScript's own suggestion, so nothing here repeats it.
 * What is left are the two faults a type cannot see, because both are about SHAPE:
 *
 * | written | the types |
 * |---|---|
 * | `form { opacity: 0 }` in `@@keyframes` | **silent** — any string is a frame to an index signature |
 * | `opacity: 0` loose in `@@keyframes` | **silent** — same signature accepts it |
 * | `&:hover { … }` in `@@font-face` | `TS2353`, but about a descriptor, not about nesting |
 */
/** The findings for a block's own CSS, with no named site around it. */
export function checkNamedFree(css: string): Finding[] {
  const source = `const x = @@(\n${css}\n);`;
  const [site] = findBlocks(source);
  const read = readBlock(source, site.open, "Card.tsx", { tolerant: true });
  return checkBlock(read.block).sort((a, b) => a.at - b.at);
}

export function checkNamed(at: string, css: string): Finding[] {
  const source = `const x = @@${at}(\n${css}\n);`;
  const [site] = findBlocks(source);
  const read = readBlock(source, site.open, "Card.tsx", { tolerant: true });
  return checkBlock(read.block, { at: site.at }).sort((a, b) => a.at - b.at);
}
