import { positionOf } from "../syntax";
import { openingOf } from "./element";
import type { ElementRule } from "./rule";

/**
 * An `<a>` that goes nowhere — no `href`, or one that resolves to the page it is already on.
 *
 * The tag is not what makes a link. `href` is: without it an `<a>` is not focusable, is not in the
 * tab order, is not announced as a link, and does not answer the middle click, the context menu or
 * the "open in new tab" that people use links with. It renders looking exactly like one, which is
 * why this is worth reporting — the page looks right and only half of the people using it can
 * follow the link.
 *
 * Four spellings say the same thing and all four are reported:
 *
 * - **No `href` at all.** Usually an `onClick` was added instead, which is a button wearing a link's
 *   clothes.
 * - **`href=""`.** A destination that is the page it is already on, so following it RELOADS —
 *   losing what the reader had typed and where they had scrolled to. Worse than the bare `#` below
 *   rather than the same.
 * - **`href="#"`.** A destination that is this page, kept only so the element stays focusable. The
 *   handler then has to cancel the navigation it just asked for.
 * - **`href="javascript:…"`.** Not a destination either, and the one shape a Content Security Policy
 *   is most likely to refuse outright.
 *
 * ## What is deliberately not reported
 *
 * **A fragment that names something** — `href="#pricing"` is a real destination on this page, and
 * the whole point of a table of contents. Only the bare `#` is empty.
 *
 * **An `<a>` with an `id` or a `name` and no `href`**, which is the legacy anchor TARGET: an element
 * written to be jumped to rather than to jump. Rare now, still valid, and reporting it would report
 * markup that is doing the opposite of this fault.
 *
 * **An anchor whose `href` is COMPUTED, and a `<Link>` at the call site.** Measured against the
 * router's own, which is the shape an application actually writes: `<a href={this.currentHref}>`,
 * where `currentHref` is a getter reading the props AND the router's state. The element is right
 * there in the render and the attribute is written on it — and what it holds is settled at runtime,
 * so there is nothing here to read. The prop at the call site is not the anchor's `href` either; it
 * is one input to that computation. Judging either would be guessing, so `packages/router` is
 * silent and correctly so.
 *
 * This is the family's own stance rather than a gap: what `<Panel href="#" />` does with the prop is
 * decided inside `Panel`, and an `href` this cannot read is not an `href` that is missing.
 */
export interface LinkWithoutADestinationIssue {
  /** Which of the four shapes it is, because what each one costs differs. */
  kind: "no href" | "empty href" | "empty fragment" | "javascript:";
  /** Whether a click handler was written instead, which decides what the advice should say. */
  handled: boolean;
  file: string;
  line: number;
  column: number;
}

/**
 * What each shape actually costs, which is NOT the same sentence three times.
 *
 * `<a href="#">` IS focusable and IS announced as a link — the fault there is that the destination
 * is this page, so every way of following a link but the plain click does the wrong thing. Only the
 * one with no `href` at all is outside the tab order. A report that said "not focusable" about all
 * four would be wrong about three of them, on the line where somebody is deciding whether to believe
 * it.
 */
const SAYS: Readonly<Record<LinkWithoutADestinationIssue["kind"], string>> = {
  "no href": "no `href` at all, so it is not focusable, not in the tab order, and not announced as a link",
  "empty href":
    "an empty `href`, which resolves to the page it is already on — so following it RELOADS, losing " +
    "whatever the reader had typed and scrolled to",
  "empty fragment":
    '`href="#"`, which is this page — a middle click, "open in new tab" and the context menu all ' + "go nowhere",
  "javascript:":
    "a `javascript:` href, which is not a destination — every way of following a link but a plain " +
    "click does nothing, and a Content Security Policy refuses this shape first",
};

export const linkWithoutADestination = {
  id: "link-without-a-destination",

  report: {
    severity: "warn",
    reportedWhen: "an `<a>` has no `href`, or one that goes nowhere — empty, `#`, or `javascript:`",
    heading: (found) => `${found.length} link(s) with nowhere to go:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      // The handler is named only where it is the diagnosis: an `<a>` with a click and no `href` is
      // a button wearing a link's clothes, which is the whole sentence. Beside `href="#"` it adds
      // nothing the line does not already say.
      `    <a> has ${issue.kind === "no href" && issue.handled ? "an `onClick` but " : ""}${SAYS[issue.kind]}${
        issue.kind !== "no href" && issue.handled ? ", and the handler has to cancel the navigation it asked for" : ""
      }.`,
    ],
    advice:
      "The tag is not what makes a link; `href` is. Without a real one an `<a>` is not focusable, is\n" +
      "not in the tab order, is not announced as a link, and does not answer a middle click, a\n" +
      'context menu or an "open in new tab". It still LOOKS like a link, which is why the page\n' +
      "seems fine.\n\n" +
      "If it navigates, give it the destination — `<a href={…}>`, or the `Link` the router builds,\n" +
      "which writes a real one. If it does not navigate, it is a `<button>`: that is the element\n" +
      "for something that acts on this page, and it is focusable, announced and keyboard-operable\n" +
      "without anything being written on it.\n\n" +
      '`href="#section"` is a real destination and is not reported. Only the bare `#` is.\n\n' +
      "This is a warning today and an error in a later version.",
  },

  read(element, { tag, attr, has }) {
    if (tag !== "a") return [];

    const handled = has("onClick");
    const at = positionOf(openingOf(element));

    if (!has("href")) {
      // The legacy anchor TARGET — written to be jumped to, not to jump. Still valid markup, and
      // reporting it would report the opposite of this fault.
      if (has("id") || has("name")) return [];
      return [{ kind: "no href" as const, handled, ...at }];
    }

    // Only a literal is a claim. `href={to}` may be anything, and this cannot know which.
    const written = attr("href");
    if (written === undefined) return [];

    // An empty `href` is the shape the first version of this rule missed, found by auditing the
    // claim against the code: "one that goes nowhere" plainly covers it, and the enumeration behind
    // the claim did not. It is worse than `#` rather than the same — a bare `#` jumps to the top of
    // the page, while an empty one reloads it.
    if (written.trim() === "") return [{ kind: "empty href" as const, handled, ...at }];
    if (written.trim() === "#") return [{ kind: "empty fragment" as const, handled, ...at }];
    if (/^\s*javascript:/i.test(written)) return [{ kind: "javascript:" as const, handled, ...at }];

    return [];
  },
} as const satisfies ElementRule<LinkWithoutADestinationIssue>;
