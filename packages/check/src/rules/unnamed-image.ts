import ts from "typescript";
import { positionOf } from "../syntax";
import { openingOf } from "./element";
import type { ElementRule, JsxElementLike } from "./rule";

/**
 * An image nothing can describe.
 *
 * A screen reader announces an image by its `alt`. Without one it announces the file name, or the
 * word "image", or nothing — and a page whose images carry meaning becomes a page with holes in it
 * for everyone who cannot see them.
 *
 * **An empty `alt=""` is correct and is not reported.** It is the documented way to say "this image
 * is decoration, skip it", and a rule that demanded text there would push authors into describing
 * spacers and dividers, which is worse than silence. What is reported is the attribute being
 * ABSENT, which says nothing at all — neither that it matters nor that it does not.
 */
export interface UnnamedImageIssue {
  /** The tag that carries no description — `img`, `area`, `input`, `object`. */
  tag: string;
  file: string;
  line: number;
  column: number;
}

/**
 * The four tags this asks about, and why it is these four.
 *
 * `img` and `area` are images by definition. An `input` is one only when its type says so, which is
 * checked below. `object` may be anything, and its fallback is its children rather than an `alt` —
 * which is why it is allowed to answer with content instead.
 */
const IMAGES = new Set(["img", "area", "input", "object"]);

/** Any of these names an element, so any of them answers the question. */
const NAMES_IT = ["alt", "aria-label", "aria-labelledby", "title"];

export const unnamedImage = {
  id: "unnamed-image",

  report: {
    severity: "warn",
    reportedWhen:
      "an `img`, `area`, image `input` or empty `object` has no `alt`, `aria-label`, " + "`aria-labelledby` or `title`",
    heading: (found) => `${found.length} image(s) with nothing to announce them by:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    <${issue.tag}> has no \`alt\`, and no \`aria-label\`, \`aria-labelledby\` or \`title\` either.`,
    ],
    advice:
      "A screen reader announces an image by its `alt`. With none it reads the file name, or the\n" +
      'word "image", or nothing at all.\n\n' +
      'If the image carries meaning, describe it: `alt="Revenue, rising through Q3"`. If it is\n' +
      'decoration — a spacer, a divider, an icon beside a word that already says it — write `alt=""`\n' +
      "and the screen reader skips it. Both are answers; only silence is not.\n\n" +
      "This is a warning today and an error in a later version.",
  },

  read(element, { tag, has, attr }) {
    if (tag === undefined || !IMAGES.has(tag)) return [];

    // An `<input>` is an image only when it says so. Every other type is a control with its own
    // labelling rules, and reporting those here would be reporting the wrong fault.
    if (tag === "input" && attr("type")?.toLowerCase() !== "image") return [];

    if (NAMES_IT.some((name) => has(name))) return [];

    // An `<object>` names itself with its fallback content, which is the documented way round for
    // it. Only an empty one has nothing.
    if (tag === "object" && hasChildren(element)) return [];

    return [{ tag, ...positionOf(openingOf(element)) }];
  },
} as const satisfies ElementRule<UnnamedImageIssue>;

/** Whether the element was written with a body at all — `<object>…</object>` rather than `<object />`. */
function hasChildren(element: JsxElementLike): boolean {
  return ts.isJsxElement(element) && element.children.length > 0;
}
