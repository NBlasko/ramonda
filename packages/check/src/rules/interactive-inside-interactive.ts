import { positionOf } from "../syntax";
import { openingOf, tagOf } from "./element";
import { NOT_INSIDE_ITSELF, enclosingElement } from "./html";
import type { ElementRule, JsxElementLike } from "./rule";

/**
 * A link inside a link, a button inside a button, a form inside a form, a label inside a label.
 *
 * None of these survives the parser. Meeting the second, it closes the first — so the markup that
 * reaches the page is not the markup that was written, and the failure is behavioural rather than
 * visual: the inner control ends up a sibling of the outer, a click lands on whichever the browser
 * decided is on top, and a nested form submits fields the outer one thought were its own.
 *
 * Written in JSX it looks perfectly reasonable, because JSX has no content model — it nests
 * whatever you nest. This is the one place a checker can see what the parser will do and the
 * compiler cannot.
 */
export interface InteractiveInsideInteractiveIssue {
  /** The tag, which is the same on both sides — that is what makes it this fault. */
  tag: string;
  file: string;
  line: number;
  column: number;
}

/**
 * Whether any enclosing element, not just the nearest, is the same tag.
 *
 * The nearest is not enough: `<a><span><a/></span></a>` is the same fault with a wrapper in it, and
 * a wrapper is exactly how it gets written. The walk stops where {@link enclosingElement} stops —
 * at a function boundary — so a component in between makes it unprovable and it says nothing.
 */
function insideSameTag(element: JsxElementLike, tag: string): boolean {
  let at = enclosingElement(element);
  while (at !== undefined) {
    const enclosing = tagOf(at);
    // A component in the way: what it renders is decided inside it, so nothing is claimed.
    if (enclosing === undefined) return false;
    if (enclosing === tag) return true;
    at = enclosingElement(at);
  }
  return false;
}

export const interactiveInsideInteractive = {
  id: "interactive-inside-interactive",

  report: {
    severity: "warn",
    reportedWhen:
      "an interactive element is nested inside another of the same kind: a link in a " +
      "link, a button in a button, a form in a form",
    heading: (found) => `${found.length} element(s) nested inside another of the same kind:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    <${issue.tag}> is inside another <${issue.tag}>, which the HTML parser will not keep.`,
    ],
    advice:
      "Meeting the second, the parser closes the first. The inner element becomes a SIBLING of the\n" +
      "outer one, so the tree the browser builds is not the tree in your source — and the failure is\n" +
      "behavioural rather than visual: a click lands on whichever ended up on top, and a nested form\n" +
      "submits fields the outer one believed were its own.\n\n" +
      "Put them side by side, or make the inner one something that is not interactive — a `<span>`\n" +
      "styled to look like a button is not a button, and that is the point.\n\n" +
      "An element reached through a component is not reported: what that component renders is\n" +
      "decided inside it.\n\n" +
      "This is a warning today and an error in a later version.",
  },

  read(element, { tag }) {
    if (tag === undefined || !NOT_INSIDE_ITSELF.has(tag)) return [];
    if (!insideSameTag(element, tag)) return [];
    return [{ tag, ...positionOf(openingOf(element)) }];
  },
} as const satisfies ElementRule<InteractiveInsideInteractiveIssue>;
