import { positionOf } from "../syntax";
import ts from "typescript";
import { hasContent, openingOf, tagOf, trueAttr } from "./element";
import type { ElementContext, ElementRule } from "./rule";

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
 *
 * ## Empty in the ACCESSIBILITY tree, which is the tree this is about
 *
 * A link whose only child is `aria-hidden="true"` has content in the DOM and none where it counts —
 * the icon-only link, which is the commonest way to write this fault and was silent here. It is
 * provable without guessing: every child is hidden by a LITERAL claim, and nothing names the link.
 * One readable word beside the icon, or a component child this cannot see into, and it says nothing.
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

/**
 * Whether everything inside is explicitly removed from the accessibility tree.
 *
 * The narrow half of "empty": `<a href="/x"><span aria-hidden="true">★</span></a>` reads as full in
 * the DOM and is a blank row in the list of links a screen reader builds. Every child has to be
 * hidden by a literal claim — one word of text beside the icon, or a child whose `aria-hidden` this
 * cannot read, and the answer is no.
 *
 * A COMPONENT child answers no as well, and that is deliberate rather than incidental: what
 * `<Icon />` renders is not in this file, so whether it announces anything is not knowable here.
 */
function everyChildIsHidden(children: readonly ts.JsxChild[], resolve: ElementContext["resolve"]): boolean {
  let hidden = 0;

  for (const child of children) {
    if (ts.isJsxText(child)) {
      if (child.text.trim().length > 0) return false;
      continue;
    }
    if (ts.isJsxExpression(child)) {
      if (child.expression === undefined) continue;
      if (ts.isStringLiteralLike(child.expression)) {
        if (child.expression.text.trim().length > 0) return false;
        continue;
      }
      return false;
    }
    if (!ts.isJsxElement(child) && !ts.isJsxSelfClosingElement(child)) return false;
    // A component's markup is somewhere else, so nothing here can say what it announces.
    if (tagOf(child) === undefined) return false;
    if (trueAttr(child, "aria-hidden", resolve) !== true) return false;
    hidden++;
  }

  return hidden > 0;
}

export const emptyHeadingOrLink = {
  id: "empty-heading-or-link",

  report: {
    severity: "warn",
    reportedWhen: "a heading or a link has nothing inside it to announce",
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

  read(element, { tag, has, children, resolve }) {
    if (tag === undefined) return [];

    const kind = HEADINGS.has(tag) ? "heading" : tag === "a" ? "link" : undefined;
    if (kind === undefined) return [];

    if (NAMES_IT.some((name) => has(name))) return [];
    if (hasContent(children) && !everyChildIsHidden(children, resolve)) return [];

    return [{ tag, kind, ...positionOf(openingOf(element)) }];
  },
} as const satisfies ElementRule<EmptyHeadingOrLinkIssue>;
