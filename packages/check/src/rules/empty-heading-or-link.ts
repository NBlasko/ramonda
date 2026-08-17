import { positionOf } from "../syntax";
import { hasContent, openingOf } from "./element";
import type { ElementRule } from "./rule";

/**
 * A heading or a link with nothing inside it.
 *
 * Two tags, one rule, because it is one fault: an element whose entire job is to carry text,
 * carrying none. They are worth separating from every other empty element because assistive
 * technology treats these two specially — a screen reader builds a list of headings to jump
 * between, and a list of links to tab through. An empty one is a row in that list with no label:
 * present, reachable, and unusable.
 *
 * An `aria-label` answers for both, because that is what it is for.
 */
export interface EmptyHeadingOrLinkIssue {
  /** `h1`–`h6`, or `a`. */
  tag: string;
  /** What the tag is FOR, so the report can say what is missing rather than name a rule. */
  kind: "heading" | "link";
  file: string;
  line: number;
  column: number;
}

const HEADINGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

/** Any of these names the element without text inside it. */
const NAMES_IT = ["aria-label", "aria-labelledby", "title"];

export const emptyHeadingOrLink = {
  id: "empty-heading-or-link",

  report: {
    severity: "warn",
    heading: (found) => {
      const headings = found.filter((issue) => issue.kind === "heading").length;
      const links = found.length - headings;
      const parts = [
        headings > 0 ? `${headings} empty heading(s)` : "",
        links > 0 ? `${links} empty link(s)` : "",
      ].filter(Boolean);
      return `${parts.join(" and ")}:`;
    },
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      issue.kind === "heading"
        ? `    <${issue.tag}> has no text, so it is a heading with no name.`
        : `    <a> has no text, so it is a link with no name.`,
    ],
    advice:
      "A screen reader builds a list of headings to jump between and a list of links to tab\n" +
      "through. An empty one is a row in that list with nothing in it — reachable, and unusable.\n\n" +
      "Put the text inside the tag. Where the text is genuinely elsewhere — an icon-only link, a\n" +
      "heading whose words are drawn — `aria-label` says what it is, and is accepted here.\n\n" +
      "An element whose content this cannot read is left alone: `<h2>{title}</h2>` may well have\n" +
      "text and nothing here can prove it does not.\n\n" +
      "This is a warning today and an error in a later version.",
  },

  read(element, { tag, has, children }) {
    if (tag === undefined) return [];

    const kind = HEADINGS.has(tag) ? "heading" : tag === "a" ? "link" : undefined;
    if (kind === undefined) return [];

    if (hasContent(children)) return [];
    if (NAMES_IT.some((name) => has(name))) return [];

    return [{ tag, kind, ...positionOf(openingOf(element)) }];
  },
} as const satisfies ElementRule<EmptyHeadingOrLinkIssue>;
