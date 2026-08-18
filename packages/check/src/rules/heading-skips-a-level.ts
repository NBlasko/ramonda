import { positionOf } from "../syntax";
import type { TreeRule } from "./rule";

/**
 * A heading that jumps more than one level below the heading before it.
 *
 * Headings are not sizes. They are the document's outline, and a screen reader exposes them as a
 * navigable list with a level each — the commonest way a page is read by someone who is not
 * looking at it. `<h1>` then `<h3>` says there is an `<h2>` section that has been skipped, so the
 * outline claims a level that is not there and the reader is told the section they are in is
 * nested inside something that does not exist.
 *
 * **Going back UP is not a fault.** `<h3>` followed by `<h2>` is simply the end of one section and
 * the start of the next, which is what an outline does. Only the descent has to be one step at a
 * time.
 */
export interface HeadingSkipsALevelIssue {
  /** The level written — `3` for an `<h3>`. */
  level: number;
  /** The level of the heading before it. */
  after: number;
  /** The line that heading is on. */
  afterAtLine: number;
  file: string;
  line: number;
  column: number;
}

/** `h1`…`h6`, as the level they name. */
function levelOf(tag: string | undefined): number | undefined {
  if (tag === undefined) return undefined;
  const match = /^h([1-6])$/.exec(tag);
  return match ? Number(match[1]) : undefined;
}

/**
 * A heading level skipped inside one render.
 *
 * A WARNING, which is this repository's rule for a new rule. Nothing in this repository trips it —
 * measured across every app and package.
 *
 * **Only headings that are always present**, and only within ONE render. A heading behind a
 * condition may or may not be there, so the heading after it may or may not be a skip — and the
 * level a component starts at depends on where it is mounted, which nothing static can say. So
 * this reports the case it can prove: two headings written in the same markup, both unconditional,
 * with a gap between them.
 */
export const headingSkipsALevel = {
  id: "heading-skips-a-level",

  report: {
    severity: "warn",
    reportedWhen: "a heading is more than one level below the heading before it, both written in the same render",
    heading: (found) => `${found.length} heading(s) that skip a level:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    <h${issue.level}> follows the <h${issue.after}> on line ${issue.afterAtLine}, so the outline`,
      // Read from the printed report, not from the code: the first version said "claims a level
      // that never appear" for every single-level skip, which is most of them.
      `    claims ${issue.level - issue.after === 2 ? "a level that never appears" : "levels that never appear"}.`,
    ],
    advice:
      "Headings are the document's outline, not a set of sizes. A screen reader exposes them as a\n" +
      "navigable list with a level each — for many readers it is how a page is read at all — so a\n" +
      "jump from `h1` to `h3` announces a section nested inside one that does not exist.\n\n" +
      "Use the next level down and style it however you like; `font-size` is a stylesheet's\n" +
      "decision and the level is the document's.\n\n" +
      "Going back UP is not reported: an `h3` followed by an `h2` is one section ending and another\n" +
      "beginning, which is what an outline does.\n\n" +
      "This is a warning today and an error in a later version.",
  },

  read({ elements }) {
    const found: HeadingSkipsALevelIssue[] = [];
    let previous: { level: number; line: number } | undefined;

    for (const node of elements) {
      const level = levelOf(node.tag);
      if (level === undefined) continue;

      /**
       * A heading that may not be there BREAKS the chain rather than being skipped over.
       *
       * Found by running it: with this written as `continue`, `<h1>`, `{detailed && <h2>}`,
       * `<h3>` was reported as h1 → h3 — and that markup is correct whenever `detailed` is true.
       * Forgetting the heading before it is the honest move: a report given up rather than a
       * report that sends a reader to delete the level that makes the page right.
       */
      if (!node.alwaysPresent) {
        previous = undefined;
        continue;
      }

      const where = positionOf(node.element);
      if (previous !== undefined && level - previous.level > 1) {
        found.push({ level, after: previous.level, afterAtLine: previous.line, ...where });
      }
      previous = { level, line: where.line };
    }

    return found;
  },
} as const satisfies TreeRule<HeadingSkipsALevelIssue>;
