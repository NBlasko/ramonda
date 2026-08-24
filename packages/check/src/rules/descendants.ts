import ts from "typescript";

/**
 * Whether anything INSIDE an element is the thing a rule is looking for.
 *
 * Three rules ask this and each had written its own walk: is there something interactive in here,
 * is there a usable `<track>`, is there a form control. The QUESTIONS differ and the walk does not,
 * which is this package's standing lesson about readers — and it took a third caller before anybody
 * noticed the first two were the same shape.
 *
 * ## Three answers, not two, and that is the whole point of it
 *
 * A COMPONENT in the children, or an expression, means what is really in there is decided somewhere
 * this cannot see. `{rows.map(…)}` may hold anything; `<TextField />` renders whatever it renders.
 * Neither is "no", and reading it as one is how a rule reports a page that is correct.
 *
 * Every caller so far treats `unreadable` exactly as it treats `found` — both mean "say nothing" —
 * but they are kept apart because they are different facts, and a rule that one day wants to
 * explain its silence needs to know which it met.
 */
export type Descendant = "found" | "unreadable" | "none";

export function descendantIn(
  children: readonly ts.JsxChild[],
  matches: (opening: ts.JsxOpeningLikeElement, tag: string) => boolean,
): Descendant {
  let unreadable = false;

  for (const child of children) {
    // `{rows.map(…)}` and every other expression: unreadable, so it may hold anything.
    if (ts.isJsxExpression(child)) {
      if (child.expression !== undefined) unreadable = true;
      continue;
    }

    if (ts.isJsxFragment(child)) {
      const inside = descendantIn(child.children, matches);
      if (inside === "found") return "found";
      if (inside === "unreadable") unreadable = true;
      continue;
    }

    if (!ts.isJsxElement(child) && !ts.isJsxSelfClosingElement(child)) continue;
    const opening = ts.isJsxElement(child) ? child.openingElement : child;
    const name = opening.tagName.getText();

    // A component, or a dotted name — what it renders is decided inside it.
    if (/^[A-Z]/.test(name) || name.includes(".")) {
      unreadable = true;
      continue;
    }

    if (matches(opening, name.toLowerCase())) return "found";

    if (ts.isJsxElement(child)) {
      const inside = descendantIn(child.children, matches);
      if (inside === "found") return "found";
      if (inside === "unreadable") unreadable = true;
    }
  }

  return unreadable ? "unreadable" : "none";
}
