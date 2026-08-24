import { positionOf } from "../syntax";
import { NO_ARIA } from "./aria";
import type { HostElementRule } from "./rule";

/**
 * `role` or `aria-*` on an element that has no accessibility tree node to describe.
 *
 * `<meta aria-hidden="true">`, `<script role="none">`, `<title aria-label="…">`. Every element in
 * this set is either never rendered or is the document itself, so there is nothing for assistive
 * technology to expose and nothing for an attribute to change. It is not a weak instruction; it is
 * one with no subject.
 *
 * Worth reporting rather than shrugging at, because it is always a misunderstanding worth
 * correcting: somebody believed they were hiding something, and whatever they meant to hide is
 * still there.
 */
export interface AriaWithNoSubjectIssue {
  /** The element it was written on. */
  tag: string;
  /** The attribute — `role`, or the `aria-*` name. */
  attribute: string;
  file: string;
  line: number;
  column: number;
}

export const ariaWithNoSubject = {
  id: "aria-with-no-subject",

  report: {
    severity: "warn",
    reportedWhen: "a `role` or an `aria-*` sits on an element with no accessibility tree node to describe",
    heading: (found) => `${found.length} accessibility attribute(s) on an element that cannot carry one:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    <${issue.tag}> carries \`${issue.attribute}\`, and has no accessibility tree node to describe.`,
    ],
    advice:
      "These elements are either never rendered — `meta`, `script`, `style`, `title`, `template` —\n" +
      "or they are the document itself. Assistive technology exposes no node for them, so a `role`\n" +
      "or an `aria-*` here has nothing to apply to.\n\n" +
      "If something was meant to be hidden, hide the element that shows it. `aria-hidden` on the\n" +
      "thing a reader can actually reach is what does that.\n\n" +
      "This is a warning today and an error in a later version.",
  },

  /**
   * The subject is the TAG, and no spread makes a `<meta>` into something a screen reader exposes.
   *
   * So the family-wide silence has nothing to protect here, and it was costing a real report:
   * `<meta {...rest} aria-hidden="true" />` said nothing at all.
   *
   * No order guard, though a later spread carrying `undefined` really can take the attribute off —
   * measured through `renderToString`. This is a rule about a MISUNDERSTANDING: somebody wrote
   * `aria-hidden` on a `<meta>` believing it hid something, and whatever they meant to hide is
   * still there whether or not the attribute survives to the DOM.
   */
  evenWhenSpreading: true,

  alsoOnHost: true,

  read(_element, { tag, attributes }) {
    if (tag === undefined || !NO_ARIA.has(tag)) return [];

    const found: AriaWithNoSubjectIssue[] = [];
    for (const attribute of attributes) {
      const written = attribute.name;
      const lowered = written.toLowerCase();
      if (lowered !== "role" && !lowered.startsWith("aria-")) continue;
      found.push({ tag, attribute: written, ...positionOf(attribute.at) });
    }

    return found;
  },
} as const satisfies HostElementRule<AriaWithNoSubjectIssue>;
