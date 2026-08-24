import { positionOf } from "../syntax";
import { openingOf } from "./element";
import type { TreeNode, TreeRule } from "./rule";

/**
 * Two landmarks of the same kind, neither of them named.
 *
 * A screen reader offers landmarks as a LIST — it is how somebody moves around a page without
 * scrolling through it, and for a reader who cannot see the layout it is the closest thing to
 * glancing at a page. A landmark with no accessible name is announced by its kind alone.
 *
 * So a page with a primary navigation and a footer navigation offers "navigation, navigation", and
 * the reader has to enter one to find out which it is, come back out, and try the other. With three
 * — primary, breadcrumb, footer — it stops being worth using at all, and the feature that exists to
 * make a page navigable has made it slower than reading straight through.
 *
 * The fix is one attribute, and the page looks identical afterwards, which is the whole reason this
 * is worth reporting: nothing about the rendered page will ever remind anybody.
 *
 * ## Only when NEITHER is named, which is the sharp line
 *
 * Two unnamed landmarks of one kind cannot be told apart — that is a fact about the list, not a
 * preference. One named and one unnamed CAN be: "navigation" and "Footer navigation" are two
 * different entries. The convention is to name both, and this rule deliberately does not enforce
 * the convention, only the ambiguity.
 *
 * ## What counts as a landmark here, and why it is not the whole set
 *
 * `<nav>` always is one, wherever it sits. And an explicitly WRITTEN `role` is certain because it is
 * in the source. `<header>`, `<footer>`, `<section>` and `<aside>` are deliberately absent: whether
 * they map to a landmark at all depends on where they sit in the sectioning tree, and being wrong
 * about that means reporting correct markup. That is the same cut `aria-state-with-no-role` takes,
 * for the same reason — the certain half now, the rest when the data can be afforded.
 */
export interface LandmarksThatCannotBeToldApartIssue {
  /** The landmark kind both share — `navigation`, `search`, `region`. */
  kind: string;
  /** How many of this kind are unnamed in this render. */
  count: number;
  file: string;
  line: number;
  column: number;
}

/**
 * The roles that are landmarks — the list a screen reader builds its menu from.
 *
 * `main` is absent on purpose: a page may have one, and two is `more-than-one-main`'s report rather
 * than a naming problem.
 */
const LANDMARK_ROLES: ReadonlySet<string> = new Set([
  "banner",
  "complementary",
  "contentinfo",
  "form",
  "navigation",
  "region",
  "search",
]);

/** The landmark kind this element is, when that is certain; `undefined` when it is not one. */
function landmarkKind(node: TreeNode): string | undefined {
  // A spread may carry a `role` that changes what this is, or the name that settles it.
  if (node.spreads) return undefined;

  const written = node.attr("role")?.trim().toLowerCase();
  if (written !== undefined) {
    // A chain is a list of alternatives, and which one wins is not a question about the element.
    if (written.includes(" ")) return undefined;
    return LANDMARK_ROLES.has(written) ? written : undefined;
  }
  // A `role` this cannot read may be anything, including one that is not a landmark.
  if (node.has("role")) return undefined;

  // `<nav>` is a navigation landmark wherever it sits, which is what makes it safe to read.
  return node.tag === "nav" ? "navigation" : undefined;
}

/** Whether anything gives this landmark a name a reader would hear in the list. */
function isNamed(node: TreeNode): boolean {
  // Written at all, in any form. `aria-label={t("footer")}` is somebody naming this landmark, and
  // whether the string is empty is not a question this can answer.
  return node.has("aria-label") || node.has("aria-labelledby") || node.has("title");
}

export const landmarksThatCannotBeToldApart = {
  id: "landmarks-that-cannot-be-told-apart",

  report: {
    severity: "warn",
    reportedWhen: "one render has two or more landmarks of the same kind and none of them is named",
    heading: (found) => `${found.length} landmark(s) a screen reader announces identically:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    one of ${issue.count} unnamed \`${issue.kind}\` landmarks — the list offers them all under the same word.`,
    ],
    advice:
      "A screen reader offers landmarks as a LIST, and it is how somebody moves around a page\n" +
      "without scrolling through it. A landmark with no accessible name is announced by its kind\n" +
      'alone, so two of one kind read as "navigation, navigation" and the reader has to enter one to\n' +
      "find out which it is, come back out, and try the other.\n\n" +
      "Give each one a name:\n\n" +
      "```tsx\n" +
      '<nav aria-label="Primary">…</nav>\n' +
      '<nav aria-label="Footer">…</nav>\n' +
      "```\n\n" +
      'Do not put the word "navigation" in the name — the kind is already announced, and\n' +
      '`aria-label="Primary navigation"` is read out as "Primary navigation navigation".\n\n' +
      "Where a visible heading already says what the section is, point at it instead and the two\n" +
      "cannot drift apart: `aria-labelledby={headingId}`.\n\n" +
      "Only reported when NEITHER is named. One named and one unnamed are two different entries in\n" +
      "the list, and can be told apart.\n\n" +
      "This is a warning today and an error in a later version.",
  },

  read(tree) {
    /** Landmark kind → the unnamed ones in this render, in document order. */
    const unnamed = new Map<string, TreeNode[]>();

    for (const node of tree.elements) {
      // Only elements on the page whenever this render runs: two in two arms of a ternary are one
      // landmark, and this family exists so no rule can forget that.
      if (!node.alwaysPresent) continue;
      const kind = landmarkKind(node);
      if (kind === undefined || isNamed(node)) continue;
      unnamed.set(kind, [...(unnamed.get(kind) ?? []), node]);
    }

    const found: LandmarksThatCannotBeToldApartIssue[] = [];
    for (const [kind, nodes] of unnamed) {
      // One unnamed landmark of a kind is unambiguous — there is nothing to tell it apart FROM.
      if (nodes.length < 2) continue;
      // All of them, not all-but-one: every one needs a name before the list can be read, which is
      // the opposite of `more-than-one-main`, where one is allowed and only the extras are wrong.
      for (const node of nodes) {
        found.push({ kind, count: nodes.length, ...positionOf(openingOf(node.element)) });
      }
    }
    return found;
  },
} as const satisfies TreeRule<LandmarksThatCannotBeToldApartIssue>;
