import ts from "typescript";
import { positionOf } from "../syntax";
import { NO_ARIA } from "./aria";
import { openingOf } from "./element";
import type { ElementRule } from "./rule";

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
   * Both halves of this are beyond a spread's reach.
   *
   * The subject is the TAG — a spread cannot make a `<meta>` into something with an accessibility
   * node — and what is reported is the attribute's NAME, which a spread can overwrite the value of
   * and never remove. So the family-wide silence has nothing to protect here, and it was costing a
   * real report: `<meta {...rest} aria-hidden="true" />` said nothing.
   */
  evenWhenSpreading: true,

  read(element, { tag }) {
    if (tag === undefined || !NO_ARIA.has(tag)) return [];

    const found: AriaWithNoSubjectIssue[] = [];
    for (const attribute of openingOf(element).attributes.properties) {
      if (!ts.isJsxAttribute(attribute)) continue;
      const written = attribute.name.getText();
      const lowered = written.toLowerCase();
      if (lowered !== "role" && !lowered.startsWith("aria-")) continue;
      found.push({ tag, attribute: written, ...positionOf(attribute) });
    }

    return found;
  },
} as const satisfies ElementRule<AriaWithNoSubjectIssue>;
