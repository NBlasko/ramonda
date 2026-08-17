import { positionOf } from "../syntax";
import { openingOf } from "./element";
import type { ElementRule } from "./rule";

/**
 * An `<iframe>` nothing can name.
 *
 * A frame is a document inside a document, and a screen reader lists them the way it lists headings
 * and links. Without a `title` the row in that list says "frame", which tells a reader nothing about
 * whether to enter it — and entering the wrong one means leaving the page they were reading.
 *
 * The rule is narrow on purpose: it asks whether the frame is NAMED, not whether the name is good.
 */
export interface UnnamedFrameIssue {
  file: string;
  line: number;
  column: number;
}

/** Any of these names the frame. `title` is the documented one; the other two also work. */
const NAMES_IT = ["title", "aria-label", "aria-labelledby"];

export const unnamedFrame = {
  id: "unnamed-frame",

  report: {
    severity: "warn",
    heading: (found) => `${found.length} frame(s) with no name:`,
    lines: (issue) => [`  ${issue.file}:${issue.line}:${issue.column}`, `    <iframe> has no \`title\`.`],
    advice:
      "A frame is a document inside a document, and assistive technology lists them the way it\n" +
      'lists headings and links. With no title the row says "frame", which does not tell a reader\n' +
      "whether entering it is what they want — and entering the wrong one means leaving the page.\n\n" +
      'Say what is in it: `title="Payment form"`, `title="Map of the venue"`.\n\n' +
      "This is a warning today and an error in a later version.",
  },

  read(element, { tag, has }) {
    if (tag !== "iframe") return [];
    if (NAMES_IT.some((name) => has(name))) return [];
    return [positionOf(openingOf(element))];
  },
} as const satisfies ElementRule<UnnamedFrameIssue>;
