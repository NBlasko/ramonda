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
 * ## Why this is worth a static rule when the framework already watches at runtime
 *
 * It watches a narrower thing. `RMD010` fires when a COMPONENT's default host lands in a parent
 * that will not take it, and it can only fire once that component mounts — so a table behind a tab
 * nobody opened ships with the fault. And a tag written directly in the markup, which is this rule,
 * is not what RMD010 looks at.
 *
 * There is a worse version of the same story: hydration reports a bad nesting as `RMD007`, a
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
      "An element reached through a component is NOT reported here — this cannot see what host that\n" +
      "component renders. The framework watches that side at runtime (RMD010).\n\n" +
      "This is a warning today and an error in a later version.",
  },

  /**
   * Neither half of this is an attribute, so the family's spread guard has nothing to protect.
   *
   * The subject is the TAG and the element ENCLOSING it. `<li {...rest}>` is an `<li>` whatever
   * `rest` carries, and what it sits inside is decided by the markup around it. Measured on
   * `fixtures/spread-sweep`: an `<li>` with no list around it went unreported for a spread that
   * could not have changed the answer.
   */
  evenWhenSpreading: true,

  read(element, { tag, resolve }) {
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
     * A COMPONENT in between usually makes the real parent unknowable: what `<Layout>` renders is
     * decided inside `Layout`, and it may well be the `<table>` this row needs.
     *
     * Usually, and not always — see {@link enclosingTag}. A wrapper whose `render()` hands
     * `this.props.children` straight back puts them inside its own HOST element, and that is a fact
     * in front of the walk. `<Box><tr /></Box>` with `@Host("div")` is a misplaced row and was
     * reported by nothing.
     */
    const found = enclosingTag(element, resolve);
    if (found === undefined) return [];

    if (wants.includes(found)) return [];

    return [{ tag, found, wants, ...positionOf(openingOf(element)) }];
  },
} as const satisfies ElementRule<TagNeedsItsParentIssue>;
