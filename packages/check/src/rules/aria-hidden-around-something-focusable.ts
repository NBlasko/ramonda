import ts from "typescript";
import { positionOf } from "../syntax";
import { descendantIn } from "./descendants";
import { openingOf } from "./element";
import type { ElementContext, ElementRule } from "./rule";

/**
 * `aria-hidden="true"` wrapped around something a keyboard can still reach.
 *
 * `aria-hidden` takes a subtree out of the accessibility tree. It does NOT take it out of the tab
 * order — nothing about it touches focus — so a `<button>` inside stays tabbable while ceasing to
 * exist for the software that would announce it.
 *
 * What that does to a reader is worse than either half alone. They press Tab, focus moves, and
 * their screen reader says **nothing at all**: there is no node for it to describe. Focus is
 * somewhere, the page has changed under them, and they have no way to find out where they are or
 * what pressing Enter would do. It is the one accessibility fault that leaves somebody genuinely
 * stranded rather than merely underserved.
 *
 * The commonest way to write it is a modal. The dialog opens, the page behind it is hidden from
 * assistive technology with one attribute, and every control back there is still in the tab order —
 * so the first Tab takes the reader out of the dialog and into a void.
 *
 * ## This is the sibling of `aria-hidden-on-focusable`, and the halves do not overlap
 *
 * That rule asks whether the element carrying the attribute is itself focusable. This one asks
 * whether anything INSIDE it is. Together they are the whole of the fault; separately each is a
 * sentence a reader can act on, which is why they are two reports rather than one with a flag.
 *
 * ## What it will not claim
 *
 * **Anything it cannot see.** A component in the subtree renders what it renders, and an expression
 * may hold anything — so a subtree containing either is not reported unless something focusable is
 * ALSO written out. `found` is the only answer that speaks; `unreadable` says nothing, which is the
 * silence contract and the reason this can ship.
 *
 * **A descendant taken out of the tab order.** `tabIndex={-1}` on the control inside is one of the
 * two correct fixes, and reporting it would be reporting the fix.
 *
 * **`inert`**, which is the other correct fix and the one the platform added for exactly this: it
 * removes the subtree from the tab order and from the accessibility tree together.
 */
export interface AriaHiddenAroundSomethingFocusableIssue {
  /** The element carrying `aria-hidden`. */
  tag: string;
  /** The focusable thing inside it, which is what a reader has to go and find. */
  inside: string;
  file: string;
  line: number;
  column: number;
}

/** Focusable without anybody writing a `tabIndex`. */
const FOCUSABLE_TAGS: ReadonlySet<string> = new Set(["button", "input", "select", "textarea", "summary", "iframe"]);

/** `tabIndex={-1}` written out — the one value that takes a tag out of the tab order. */
function takenOutOfTheTabOrder(opening: ts.JsxOpeningLikeElement): boolean {
  for (const attribute of opening.attributes.properties) {
    if (!ts.isJsxAttribute(attribute)) continue;
    if (attribute.name.getText().toLowerCase() !== "tabindex") continue;

    const value = attribute.initializer;
    if (value === undefined) return false;
    if (ts.isStringLiteral(value)) return value.text.trim().startsWith("-");
    if (!ts.isJsxExpression(value) || value.expression === undefined) return false;
    const written = value.expression;
    // `{-1}` is a prefix expression rather than a literal, which is the whole reason this exists.
    return ts.isPrefixUnaryExpression(written) && written.operator === ts.SyntaxKind.MinusToken;
  }
  return false;
}

/** Whether an element written inside the subtree is something a keyboard can land on. */
function isFocusable(opening: ts.JsxOpeningLikeElement, tag: string): boolean {
  if (takenOutOfTheTabOrder(opening)) return false;

  for (const attribute of opening.attributes.properties) {
    if (!ts.isJsxAttribute(attribute)) continue;
    const name = attribute.name.getText().toLowerCase();
    // A written `tabIndex` that is not negative puts anything in the tab order.
    if (name === "tabindex") return true;
    // An `<a>` is focusable only WITH an href, and that is the whole of the difference.
    if (name === "href" && tag === "a") return true;
    // An `<input type="hidden">` is not focusable, and is the one input that is not.
    if (name === "type" && tag === "input") {
      const value = attribute.initializer;
      const written = value !== undefined && ts.isStringLiteral(value) ? value.text.toLowerCase() : undefined;
      if (written === "hidden") return false;
    }
  }
  return FOCUSABLE_TAGS.has(tag);
}

export const ariaHiddenAroundSomethingFocusable = {
  id: "aria-hidden-around-something-focusable",

  report: {
    severity: "warn",
    reportedWhen: '`aria-hidden="true"` wraps something a keyboard can still tab to',
    heading: (found) => `${found.length} hidden subtree(s) a keyboard can still tab into:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    <${issue.tag} aria-hidden="true"> still contains a focusable <${issue.inside}> — a reader can tab into it and hear nothing.`,
    ],
    advice:
      "`aria-hidden` takes a subtree out of the accessibility tree and does NOT take it out of the\n" +
      "tab order — nothing about it touches focus. So the control inside stays tabbable while\n" +
      "ceasing to exist for the software that would announce it.\n\n" +
      "What that does to a reader is worse than either half alone: they press Tab, focus moves, and\n" +
      "their screen reader says nothing at all, because there is no node left to describe. They\n" +
      "have no way to find out where they are or what Enter would do.\n\n" +
      "Reach for `inert` — the platform added it for exactly this, and it removes the subtree from\n" +
      "the tab order and from the accessibility tree together:\n\n" +
      "```tsx\n" +
      "<div inert>…</div>\n" +
      "```\n\n" +
      "Where `inert` is not available, `tabIndex={-1}` on every control inside does the focus half\n" +
      "by hand — which is a list that has to be kept in step, and is why `inert` exists.\n\n" +
      "This is the commonest thing to get wrong about a modal: the dialog opens, the page behind it\n" +
      "is hidden with one attribute, and the first Tab takes the reader out of the dialog and into\n" +
      "a void.\n\n" +
      "This is a warning today and an error in a later version.",
  },

  read(element, { tag, truth, has, children }: ElementContext) {
    if (tag === undefined) return [];
    if (truth("aria-hidden") !== true) return [];
    // `inert` is the correct fix, and it does the focus half as well as this one.
    if (has("inert")) return [];

    let inside: string | undefined;
    const answer = descendantIn(children, (opening, found) => {
      if (!isFocusable(opening, found)) return false;
      inside = found;
      return true;
    });
    // `found` is the only answer that speaks. `unreadable` is a component or an expression, and
    // guessing at what one renders is how a rule reports a page that is correct.
    if (answer !== "found" || inside === undefined) return [];

    return [{ tag, inside, ...positionOf(openingOf(element)) }];
  },
} as const satisfies ElementRule<AriaHiddenAroundSomethingFocusableIssue>;
