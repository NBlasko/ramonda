import { positionOf } from "../syntax";
import { ACTIVATED_BY_THE_USER } from "./aria";
import { descendantIn } from "./descendants";
import { openingOf } from "./element";
import { hasAKeyHandler, pointerHandlerOn } from "./events";
import { INTERACTIVE } from "./click-with-no-keyboard-path";
import type { ElementContext, ElementRule } from "./rule";

/**
 * A control built by hand, and the building stopped half way.
 *
 * `<div role="button" onclick={save}>` is somebody taking on work the platform does for a
 * `<button>`. The role is the announcement — a screen reader now says "button" — and the rest of
 * what a button is has to be written out: it must be reachable by Tab, and it must answer Enter and
 * Space. Neither comes with the role.
 *
 * Two ways it stops short, and they fail differently:
 *
 * - **No `tabIndex`.** A reader is told there is a button and cannot get to it at all. The mouse
 *   works, so it looks finished to whoever wrote it.
 * - **`tabIndex` and no key handler.** Tab lands on it, the reader presses Enter, and nothing
 *   happens — which is worse than not reaching it, because they have been told it is a button and
 *   given every reason to believe they used it correctly.
 *
 * ## The rule that asks for this one by name
 *
 * `click-with-no-keyboard-path` reports a click on a plain element with NO role, no `tabIndex` and
 * no key handler. It goes quiet the moment any of those appears, and its own comment says why: "a
 * half-built path is somebody's decision to build it by hand, and picking at it is a different rule
 * from this one." This is that rule. The two enter on the same condition — a pointer handler on an
 * element that is not natively interactive — and split on whether the author had started.
 *
 * ## Why a pointer handler is required
 *
 * It is what makes the report certain rather than a guess about intent. `<div role="button">` with
 * nothing wired to it may be a wrapper whose handler is attached through a ref, or markup on its way
 * to somewhere else. A pointer handler beside the role is the author saying, on the line, that this
 * element is operated — and operated by the mouse only.
 */
export interface HalfBuiltKeyboardPathIssue {
  /** The tag it was written on. */
  tag: string;
  /** The role that made the promise. */
  role: string;
  /** The pointer handler that shows the mouse was wired, as written. */
  handler: string;
  /** Which half is missing, because the two fail differently and the advice differs. */
  missing: "the tab order" | "a key handler";
  file: string;
  line: number;
  column: number;
}

export const halfBuiltKeyboardPath = {
  id: "half-built-keyboard-path",

  report: {
    severity: "warn",
    reportedWhen:
      "an element with an interactive `role` and a pointer handler is missing the `tabIndex` or the key handler that would finish it",
    heading: (found) => `${found.length} hand-built control(s) a keyboard cannot finish using:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      issue.missing === "the tab order"
        ? `    <${issue.tag} role="${issue.role}" ${issue.handler}={…}> has no \`tabIndex\`, so Tab never reaches it.`
        : `    <${issue.tag} role="${issue.role}" ${issue.handler}={…}> is reachable, and Enter and Space do nothing.`,
    ],
    advice:
      "A `role` is an announcement, not an implementation. It tells a screen reader this is a\n" +
      "button; it does not make Tab stop here, and it does not make Enter do anything. Both have to\n" +
      "be written out, and a control is only usable when all three are:\n\n" +
      "```tsx\n" +
      '<div role="button" tabIndex={0} onclick={save} onkeydown={onKey}>Save</div>\n' +
      "```\n\n" +
      'The far better answer is to stop building it. A `<button type="button" onclick={save}>` is\n' +
      "reachable, announced and operable by Enter and Space with nothing written on it, and it stays\n" +
      "that way when somebody edits the line a year from now:\n\n" +
      "```tsx\n" +
      '<button type="button" onclick={save}>Save</button>\n' +
      "```\n\n" +
      "If it must be a `<div>` — a drag target, a cell in a grid — the key handler has to answer\n" +
      "both keys a button answers, because the reader was told it is a button and will try either.\n\n" +
      "This is a warning today and an error in a later version.",
  },

  // No `evenWhenSpreading`, and here the family's default IS the guard this rule wants: a spread
  // may be carrying the `tabIndex` or the key handler, which is exactly the doubt that would make
  // the report untrue, so the element is not asked about at all.

  read(element, { tag, attr, has, children }: ElementContext) {
    if (tag === undefined || INTERACTIVE.has(tag)) return [];

    // A role this cannot READ may be anything, and a chain is a list of alternatives whose winner
    // is not a question about this element.
    const role = attr("role")?.trim().toLowerCase();
    if (role === undefined || role.includes(" ") || !ACTIVATED_BY_THE_USER.has(role)) return [];

    const opening = openingOf(element);
    const handler = pointerHandlerOn(opening);
    if (handler === undefined) return [];

    /**
     * A real control inside is somewhere for the keyboard to land, and a COMPONENT may be one.
     *
     * The same silence `click-with-no-keyboard-path` keeps, through the same walk: what a component
     * renders is decided inside it, and guessing is how a rule reports a working card as broken.
     */
    if (descendantIn(children, (_child, inside) => INTERACTIVE.has(inside)) !== "none") return [];

    // `has`, not the number: the question is whether somebody reached for a tab order at all, and
    // an unreadable `tabIndex={n}` is as much of a reach as a written one. `tabIndex={-1}` is a
    // deliberate choice too — focus moved by script rather than by Tab.
    if (!has("tabIndex")) {
      return [{ tag, role, handler, missing: "the tab order" as const, ...positionOf(opening) }];
    }

    if (!hasAKeyHandler(opening)) {
      return [{ tag, role, handler, missing: "a key handler" as const, ...positionOf(opening) }];
    }

    return [];
  },
} as const satisfies ElementRule<HalfBuiltKeyboardPathIssue>;
