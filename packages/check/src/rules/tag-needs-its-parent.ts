import { positionOf } from "../syntax";
import { openingOf } from "./element";
import { NEEDS_PARENT, enclosingElement, enclosingTag } from "./html";
import type { ElementRule } from "./rule";

/**
 * A tag that only means anything inside a particular parent, written somewhere else.
 *
 * `<tr>` outside a table, `<option>` outside a select, `<summary>` outside a details. The HTML
 * parser does not keep these where they were written — it moves them, or drops them, or closes the
 * element it was in the middle of. So the tree the browser builds is not the tree in the source,
 * and everything downstream reasons about the wrong one.
 *
 * ## Why this is worth a static rule
 *
 * Nothing catches it at runtime any more, and what used to come closest was about a different
 * fault: `RMD010` reported a COMPONENT's host element landing in a parent that would not take it,
 * and a component has no element now — the tag this rule reads is one somebody wrote.
 *
 * What is left at runtime is worse than nothing: hydration reports a bad nesting as `RMD007`, a
 * server/client MISMATCH, because the parser moved the node and the client's tree no longer matches
 * the server's. The advice RMD007 gives is about non-determinism, so a reader is sent looking for a
 * clock or a random number that is not there.
 */
export interface TagNeedsItsParentIssue {
  /** The tag that was misplaced. */
  tag: string;
  /** What it was found inside, or `undefined` when it was found at the top of a render. */
  found?: string;
  /** The parents it may have, for advice that does not make the reader look them up. */
  wants: readonly string[];
  file: string;
  line: number;
  column: number;
}

export const tagNeedsItsParent = {
  id: "tag-needs-its-parent",

  report: {
    severity: "warn",
    reportedWhen:
      "a tag is written outside the parent it requires — `<tr>` with no table above it, " + "`<option>` with no select",
    heading: (found) => `${found.length} tag(s) written outside the parent they need:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    <${issue.tag}> is ${issue.found ? `inside <${issue.found}>` : "not inside any element here"}, ` +
        `and belongs in ${issue.wants.map((tag) => `<${tag}>`).join(" or ")}.`,
    ],
    advice:
      "The HTML parser does not leave these where they are written. It moves them, drops them, or\n" +
      "closes the element it was in the middle of — so the tree the browser builds is not the tree\n" +
      "in your source, and every measurement, selector and hydration step after that reasons about\n" +
      "the wrong one.\n\n" +
      "On a server-rendered page the symptom is especially misleading: the parser moves the node,\n" +
      "the client's tree stops matching the server's, and it is reported as a hydration mismatch\n" +
      "whose advice is about clocks and random numbers.\n\n" +
      "An element reached through a component is NOT reported here — what a component renders is\n" +
      "decided inside it, and it may well be the parent this tag needs.\n\n" +
      "This is a warning today and an error in a later version.",
  },

  read(element, { tag }) {
    if (tag === undefined) return [];

    const wants = NEEDS_PARENT[tag];
    if (wants === undefined) return [];

    /**
     * No enclosing element at all means this is the root of a render, or was returned from
     * somewhere this cannot follow. Either way the parent is decided elsewhere, so nothing is
     * claimed about it.
     */
    if (enclosingElement(element) === undefined) return [];

    /**
     * A COMPONENT in between makes the real parent unknowable: what `<Layout>` renders is decided
     * inside `Layout`, and it may well be the `<table>` this row needs. Going quiet here is the
     * same silence contract every other rule keeps.
     */
    const found = enclosingTag(element);
    if (found === undefined) return [];

    if (wants.includes(found)) return [];

    return [{ tag, found, wants, ...positionOf(openingOf(element)) }];
  },
} as const satisfies ElementRule<TagNeedsItsParentIssue>;
