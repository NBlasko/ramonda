import { positionOf } from "../syntax";
import { ACTIVATED_BY_THE_USER } from "./aria";
import { descendantIn } from "./descendants";
import { coreElementTag } from "./coreElements";
import { openingOf, tagOf } from "./element";
import { enclosingElement } from "./html";
import { hasAKeyHandler, pointerHandlerOn } from "./events";
import { INTERACTIVE } from "./click-with-no-keyboard-path";
import type { ElementContext, ElementRule, JsxElementLike } from "./rule";

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
  /** The widget role, when one was written. Absent is itself one of the ways this stops short. */
  role?: string;
  /** The pointer handler that shows the mouse was wired, as written. */
  handler: string;
  /** Which half is missing, because the two fail differently and the advice differs. */
  missing: "a role" | "the tab order" | "a key handler";
  file: string;
  line: number;
  column: number;
}

/**
 * Whether the keyboard might be handled ABOVE this element — either provably, or unknowably.
 *
 * Two answers collapse into one `true`, and that is deliberate: both mean "do not report".
 *
 * **A key handler written on an ancestor** is the composite widget in one render — a `listbox`
 * taking the arrow keys with its options carrying a roving `tabIndex={-1}`, and `toolbar` and
 * `tablist` the same.
 *
 * **A COMPONENT ancestor**, which is the same widget written the way anyone actually builds one:
 * `<Toolbar>` renders the `role="toolbar"` and the `onkeydown`, and takes the buttons as children.
 * From here that is a capitalised tag with nothing on it, and what it puts around its children is
 * decided in another file. Reported, it is a false report against the recommended shape — measured
 * on a plant, and the reason this note exists: the same-render half of it was fixed first, and the
 * cross-component half looked identical from inside the rule.
 *
 * The cost is a real report lost when the component ancestor is a plain `<Layout>` that handles no
 * keys at all. That is the trade this package takes every time: a false report against a widget
 * built correctly costs more than a missed one against a widget built wrongly.
 */
function keysHandledAbove(element: JsxElementLike, resolve: ElementContext["resolve"]): boolean {
  let at = enclosingElement(element);
  while (at !== undefined) {
    if (hasAKeyHandler(openingOf(at))) return true;
    // A component: what it renders around its children is decided inside it, and this cannot read it.
    if (tagOf(at) === undefined && coreElementTag(openingOf(at).tagName, resolve) === undefined) return true;
    at = enclosingElement(at);
  }
  return false;
}

/** One sentence per way of stopping short, because the three fail differently. */
function subject(issue: HalfBuiltKeyboardPathIssue): string {
  const written = issue.role === undefined ? "" : ` role="${issue.role}"`;
  const element = `<${issue.tag}${written} ${issue.handler}={…}>`;

  if (issue.missing === "a role") {
    return `    ${element} is operable and announced as plain text — nothing says it does anything.`;
  }
  if (issue.missing === "the tab order") {
    return `    ${element} has no \`tabIndex\`, so Tab never reaches it.`;
  }
  return `    ${element} is reachable, and Enter and Space do nothing.`;
}

export const halfBuiltKeyboardPath = {
  id: "half-built-keyboard-path",

  report: {
    severity: "warn",
    reportedWhen:
      "an element with an interactive `role` and a pointer handler is missing the `tabIndex` or the key handler that would finish it",
    heading: (found) => `${found.length} hand-built control(s) a keyboard cannot finish using:`,
    lines: (issue) => [`  ${issue.file}:${issue.line}:${issue.column}`, subject(issue)],
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

  read(element, { tag, attr, has, children, resolve }: ElementContext) {
    if (tag === undefined || INTERACTIVE.has(tag)) return [];

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

    /**
     * Keys handled ABOVE are keys handled, and this is the shape that made the rule wrong.
     *
     * The W3C's own authoring patterns put the keyboard on the CONTAINER: a `listbox` takes the
     * arrow keys and its options carry a roving `tabIndex={-1}`, and a `toolbar` and a `tablist` do
     * the same. Read as elements on their own, every child of one of those is a control with a
     * click and no key handler — and reporting them means reporting the recommendation.
     *
     * Measured before this existed: the canonical listbox, toolbar and tablist produced four
     * reports, all of them against markup that is the documented right answer.
     */
    if (keysHandledAbove(element, resolve)) return [];

    // A role this cannot READ may be a widget or may not, and a chain is a list of alternatives
    // whose winner is not a question about this element. Either way nothing here is provable.
    const written = attr("role")?.trim().toLowerCase();
    if (has("role") && (written === undefined || written.includes(" "))) return [];
    const role = written !== undefined && ACTIVATED_BY_THE_USER.has(written) ? written : undefined;

    /**
     * `has`, not the number, and not `attr`: the question is whether somebody REACHED for each of
     * these, not what they reached for. An unreadable `tabIndex={n}` is as much of a reach as a
     * written one, and `tabIndex={-1}` is a deliberate choice — focus moved by script rather than
     * by Tab — so both count as built.
     */
    const inTheTabOrder = has("tabIndex");
    const answersAKey = hasAKeyHandler(opening);

    /**
     * Nothing started is the SIBLING's report, and this is the line between them.
     *
     * `click-with-no-keyboard-path` returns the moment it sees any one of these three, saying a
     * half-built path "is a different rule from this one". So this rule fires on exactly the
     * complement: at least one written, and not all three. No overlap, and no gap.
     */
    if (role === undefined && !inTheTabOrder && !answersAKey) return [];

    /**
     * The order is what to fix FIRST, not the order they are written in.
     *
     * A missing role comes first because it is the one nothing else compensates for: a control that
     * is reachable and operable still announces as text, and a reader who cannot tell it is a
     * control will never try. Fixing the tab order under a missing role helps nobody.
     */
    const report = (missing: HalfBuiltKeyboardPathIssue["missing"]): HalfBuiltKeyboardPathIssue => ({
      tag,
      handler,
      missing,
      ...(role === undefined ? {} : { role }),
      ...positionOf(opening),
    });

    if (role === undefined) return [report("a role")];
    if (!inTheTabOrder) return [report("the tab order")];
    if (!answersAKey) return [report("a key handler")];

    return [];
  },
} as const satisfies ElementRule<HalfBuiltKeyboardPathIssue>;
