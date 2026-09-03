import { positionOf } from "../syntax";
import { openingOf } from "./element";
import type { TreeNode, TreeRule } from "./rule";

/**
 * Two `<main>` landmarks in one render, where HTML allows one.
 *
 * The specification is explicit: a document must not have more than one `main` element that is not
 * hidden. It is the one landmark with that constraint, and it has it because `main` is not a
 * description — it is a DESTINATION. "Skip to main content" is the first thing a keyboard reader
 * presses on a page, and a screen reader's landmark list is how somebody moves around one without
 * scrolling through it.
 *
 * With two, that destination is ambiguous and the tools resolve it differently: some jump to the
 * first, some list both with the same name, and the reader has no way to tell which half of the
 * page they are being offered. Whatever they pick, half the page is now somewhere they have to find
 * by hand — and the page looks completely correct to anybody using a mouse.
 *
 * ## `role="main"` counts, because the accessibility tree does not care which spelling was used
 *
 * `<div role="main">` and `<main>` produce the same landmark. A page with one of each has two, and
 * that is the shape this is most often written in: a layout component with a `<main>` and a page
 * component that adds `role="main"` to its own wrapper, neither author seeing the other's.
 *
 * ## What it will not claim
 *
 * **One RENDER, not one project.** Two route views may each own a `main` and are never on the page
 * together — reporting that would be reporting the ordinary way a routed application is written.
 * The bound is the same one `duplicate-id` takes, and `ProjectRule`'s own note names this exact
 * case as the reason the project subject may claim only negative existence.
 *
 * **Only elements that are always there.** A `main` in one arm of a ternary and another in the
 * other arm is one landmark on the page. That is what `alwaysPresent` is computed for.
 *
 * **`hidden` is the specification's own escape**, and it is honoured: a hidden `main` is not one.
 * `hidden={false}` says out loud that the element is shown, so it does not excuse anything.
 *
 * **An element that spreads is left alone**, because the spread may be carrying the `hidden` that
 * settles it.
 */
export interface MoreThanOneMainIssue {
  /** How this one says it is a main — the tag itself, or a `role` written on it. */
  from: "the tag" | "role";
  /** The line the FIRST one is on, so a reader can compare the two without hunting. */
  firstAtLine: number;
  file: string;
  line: number;
  column: number;
}

/** Whether this element is a `main` landmark, and by which spelling. */
function mainLandmark(node: TreeNode): "the tag" | "role" | undefined {
  // A spread may be carrying the `hidden` that would take it out, so nothing is claimed about one.
  if (node.spreads) return undefined;
  /**
   * `hidden` is the specification's own escape and is honoured — but `hidden={false}` is the source
   * saying out loud that the element IS shown, which excuses nothing. The same three answers a
   * written attribute has everywhere here: true, false, and not knowable.
   */
  if (node.has("hidden") && node.truth("hidden") !== false) return undefined;

  if (node.attr("role")?.trim().toLowerCase() === "main") return "role";
  // A `role` this cannot read may be anything, including one that takes the landmark away.
  if (node.has("role")) return undefined;
  return node.tag === "main" ? "the tag" : undefined;
}

export const moreThanOneMain = {
  id: "more-than-one-main",

  report: {
    severity: "error",
    reportedWhen: "one render has more than one `main` landmark, where HTML allows one",
    heading: (found) => `${found.length} extra \`main\` landmark(s) — a page may have one:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    a second \`main\` landmark${issue.from === "role" ? ' (through `role="main"`)' : ""}, beside the one on line ${
        issue.firstAtLine
      } — "skip to main content" can only go to one of them.`,
    ],
    advice:
      "HTML allows one `main` that is not hidden, and it is the one landmark with that constraint\n" +
      'because `main` is a DESTINATION rather than a description. "Skip to main content" is the\n' +
      "first thing a keyboard reader presses, and a screen reader's landmark list is how somebody\n" +
      "moves around a page without scrolling through it.\n\n" +
      "With two, that destination is ambiguous and tools resolve it differently — some jump to the\n" +
      "first, some list both under the same name — and whichever is picked, half the page is now\n" +
      "somewhere the reader has to find by hand.\n\n" +
      '`<div role="main">` counts: it produces the same landmark as `<main>`. The commonest way to\n' +
      "end up with two is a layout component that owns a `<main>` and a page component that adds a\n" +
      "`role` to its own wrapper, neither author seeing the other's.\n\n" +
      "Keep the outer one and make the inner a `<section>` or a `<div>`, or give the inner one an\n" +
      "`aria-labelledby` and a role that says what it actually is — `region`, `complementary`,\n" +
      "`search`.\n\n" +
      "Two route views that each own a `main` are NOT this: they are never on the page together, and\n" +
      "this only ever reads one render.\n\n",
  },

  read(tree) {
    const mains: { node: TreeNode; from: "the tag" | "role" }[] = [];
    for (const node of tree.elements) {
      // Only elements that are on the page whenever this render runs — two in two arms of a
      // ternary are one landmark, and this family exists so no rule can forget that.
      if (!node.alwaysPresent) continue;
      const from = mainLandmark(node);
      if (from !== undefined) mains.push({ node, from });
    }
    if (mains.length < 2) return [];

    const first = mains[0];
    if (first === undefined) return [];
    const firstAtLine = positionOf(openingOf(first.node.element)).line;

    // The FIRST is left alone: it is the one a reader almost certainly meant, and reporting both
    // would say the page has two faults where it has one.
    return mains.slice(1).map(({ node, from }) => ({
      from,
      firstAtLine,
      ...positionOf(openingOf(node.element)),
    }));
  },
} as const satisfies TreeRule<MoreThanOneMainIssue>;
