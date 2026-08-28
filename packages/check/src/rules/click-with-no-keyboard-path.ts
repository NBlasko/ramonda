import ts from "typescript";
import { positionOf } from "../syntax";
import { descendantIn } from "./descendants";
import { hasAKeyHandler, pointerHandlerOn } from "./events";
import { hasContent, openingOf } from "./element";
import type { ElementContext, ElementRule } from "./rule";

/**
 * A click handler on something a keyboard can never reach.
 *
 * A `<div onClick={…}>` works for a mouse and for nothing else. It is not in the tab order, so it
 * cannot be focused; not being focusable, it cannot be activated by Enter or Space; and having no
 * role, a screen reader announces it as a piece of text rather than something to do. The control
 * simply is not there for anybody not using a pointer — and the page looks entirely correct.
 *
 * ## What makes it provable, and what the guard is for
 *
 * Three things have to be true at once, and all three are syntax: the element is a host element
 * that is not interactive on its own, it carries a click handler, and it has **no keyboard path** —
 * no key handler, no `tabIndex`, no `role`.
 *
 * The fourth condition is the one that makes this shippable rather than noisy. The commonest
 * CORRECT shape this would otherwise report is a wrapper that widens an existing control's hit
 * area:
 *
 * ```tsx
 * <div className="card" onClick={open}>
 *   <h3>{title}</h3>
 *   <a href={href}>Read more</a>      ← the real control, reachable by keyboard
 * </div>
 * ```
 *
 * There the keyboard path exists, one level in, and reporting the wrapper would be reporting a
 * page that works. So an element containing anything interactive — or containing a COMPONENT,
 * whose markup is decided elsewhere and cannot be read from here — is left alone.
 *
 * ## And an EMPTY one is left alone too, which was found by running it
 *
 * The first version of this rule reported two elements in this repository's own documentation site,
 * and both were correct: a backdrop.
 *
 * ```tsx
 * <div className="search-backdrop" onClick={this.close} />
 * ```
 *
 * A backdrop's click is a convenience — Escape and a close button are the real exits, and the
 * comment beside that very line says so. It has nothing inside it because there is nothing to
 * announce; it is a hit area, not a control.
 *
 * That is the distinction the rule now draws, and it is structural rather than a guess at a class
 * name: an element with CONTENT presents itself as something to do, and this reports that a
 * keyboard cannot do it. An empty one presents nothing, announces nothing, and is somebody's
 * overlay.
 */
export interface ClickWithNoKeyboardPathIssue {
  /** The tag it was written on. */
  tag: string;
  /** The handler's name, since `onClick` is not the only one. */
  handler: string;
  file: string;
  line: number;
  column: number;
}

/**
 * Tags a keyboard reaches and activates without anything being written on them.
 *
 * Exported for `half-built-keyboard-path`, which enters on the same condition this rule does — a
 * pointer handler on an element that is NOT one of these — and splits from it on whether the author
 * had started building the path by hand. Two rules dividing one territory have to agree about where
 * the territory begins.
 */
export const INTERACTIVE: ReadonlySet<string> = new Set([
  "a",
  "button",
  "input",
  "select",
  "textarea",
  "summary",
  "details",
  "label",
  "option",
]);

/**
 * Whether anything inside this element gives a keyboard somewhere to land.
 *
 * An interactive tag does, and so does a COMPONENT — not because it certainly contains one, but
 * because what it renders is decided inside it and cannot be read from here. Both make the rule go
 * quiet, which is the silence contract: the cost of being wrong is telling somebody their working
 * card is broken.
 *
 * The walk itself is `descendantIn`, shared with the two other rules that ask a question of the
 * same shape.
 */
function hasAnInteractiveDescendant(children: readonly ts.JsxChild[]): boolean {
  return descendantIn(children, (_opening, tag) => INTERACTIVE.has(tag)) !== "none";
}

export const clickWithNoKeyboardPath = {
  id: "click-with-no-keyboard-path",

  report: {
    severity: "warn",
    reportedWhen:
      "a click handler sits on a non-interactive element with no key handler, no `tabIndex`, no `role` and nothing interactive inside it",
    heading: (found) => `${found.length} click handler(s) a keyboard cannot reach:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    <${issue.tag} ${issue.handler}={…}> cannot be focused, so Enter and Space never reach it.`,
    ],
    advice:
      "A click handler on a `<div>` or a `<span>` works for a pointer and for nothing else. The\n" +
      "element is not in the tab order, so it cannot be focused; not being focusable, Enter and\n" +
      "Space never reach it; and with no role a screen reader announces it as text rather than as\n" +
      "something to do.\n\n" +
      "Almost always the answer is `<button>`: it is focusable, announced, and activated by both\n" +
      'keys without a line being written. `type="button"` and a little CSS make it look like\n' +
      "whatever it looked like before.\n\n" +
      "Where it really has to stay this tag, all three of the missing parts have to be added by\n" +
      "hand — `role`, `tabIndex={0}`, and a key handler that answers Enter and Space — which is\n" +
      "three chances to get wrong what one element gets right.\n\n" +
      "Two shapes are NOT reported. A wrapper that only widens an existing control's hit area — if\n" +
      "there is anything interactive inside it, the keyboard already has somewhere to land. And an\n" +
      "element with nothing inside it, which is a backdrop or an overlay rather than a control:\n" +
      "there is nothing to announce, and its click is a convenience beside a real exit.\n\n" +
      "This is a warning today and an error in a later version.",
  },

  read(element, context: ElementContext) {
    const { tag, has, children } = context;
    if (tag === undefined || INTERACTIVE.has(tag)) return [];

    const opening = openingOf(element);
    const handler = pointerHandlerOn(opening);
    if (handler === undefined) return [];

    // Any one of these IS a keyboard path, or an attempt at one. A half-built path is somebody's
    // decision to build it by hand, and picking at it is a different rule from this one.
    if (hasAKeyHandler(opening)) return [];
    if (has("role")) return [];
    // `has`, not `numberAttr`: the question is whether somebody reached for a tab order at all, and
    // an unreadable `tabIndex={n}` is as much of a reach as a written one.
    if (has("tabIndex")) return [];

    if (hasAnInteractiveDescendant(children)) return [];

    // An empty element announces nothing and is a hit area rather than a control — a backdrop, an
    // overlay. Found by running the first version against this repository, where both reports were
    // exactly that and both were correct markup.
    if (!hasContent(children)) return [];

    return [{ tag, handler, ...positionOf(opening) }];
  },
} as const satisfies ElementRule<ClickWithNoKeyboardPathIssue>;
