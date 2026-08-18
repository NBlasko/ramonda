import ts from "typescript";
import { positionOf } from "../syntax";
import { openingOf } from "./element";
import type { ElementRule, JsxElementLike } from "./rule";

/**
 * Two children of the same parent written with the same `key`.
 *
 * A key is how the diff decides that the node it is looking at is the node it saw last time. Two
 * children claiming the same one means only one of them can be matched: the other is treated as
 * new, so its state and its DOM go to a node that is not it — a half-typed input, an open menu, a
 * scroll position, all landing on the wrong child while the page looks right.
 *
 * The framework reports it as `RMD002` when the children actually render. This finds the case that
 * can be settled without rendering anything: keys written as literals, side by side, which is
 * exactly how the mistake is made — a row copied to make a second one, and the key copied with it.
 *
 * A key this cannot read is not compared. `key={row.id}` may collide at run time and nothing here
 * can say whether it does, which is what `RMD002` is for.
 */
export interface DuplicateKeyAmongSiblingsIssue {
  /** The key written twice. */
  key: string;
  /** The tag it was written on, for a report that reads like the source. */
  tag: string;
  file: string;
  line: number;
  column: number;
}

/**
 * A key written as something this can compare — a string or a number.
 *
 * `key="a"`, `key={"a"}` and `key={1}` are all literals and all comparable. Anything else is an
 * expression whose value is decided at run time.
 */
function literalKey(element: JsxElementLike): string | undefined {
  for (const attribute of openingOf(element).attributes.properties) {
    if (!ts.isJsxAttribute(attribute)) continue;
    if (attribute.name.getText() !== "key") continue;

    const value = attribute.initializer;
    if (value === undefined) return undefined;
    if (ts.isStringLiteral(value)) return `"${value.text}"`;
    if (ts.isJsxExpression(value) && value.expression !== undefined) {
      if (ts.isStringLiteralLike(value.expression)) return `"${value.expression.text}"`;
      if (ts.isNumericLiteral(value.expression)) return value.expression.text;
    }
    return undefined;
  }
  return undefined;
}

export const duplicateKeyAmongSiblings = {
  id: "duplicate-key-among-siblings",

  report: {
    /**
     * A warning, even though the runtime calls this an error and even though a duplicate literal
     * key is not a judgement call.
     *
     * The repository's rule for a NEW rule is that one version says so and the next refuses, and it
     * is worth keeping for a rule that is certain as much as for one that is not: the reason people
     * accept a gate is that it never arrives as a surprise. This becomes an error in a later
     * version.
     */
    severity: "warn",
    reportedWhen: "two children written side by side claim the same literal `key`",
    alsoReportedAs: "RMD002",
    heading: (found) => `${found.length} child(ren) sharing a \`key\` with a sibling:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    <${issue.tag} key=${issue.key}> — a sibling already claims that key.`,
    ],
    advice:
      "A key is how the diff decides that the node it is looking at is the node it saw last time.\n" +
      "Two children claiming the same one means only one can be matched: the other is treated as\n" +
      "new, so its state and its DOM go to a node that is not it — a half-typed input, an open\n" +
      "menu, a scroll position, all landing on the wrong child while the page still looks right.\n\n" +
      "Keys have to be unique among SIBLINGS, and only among siblings — the same key under a\n" +
      "different parent is a different key and is fine.\n\n" +
      "A key this cannot read is never compared: `key={row.id}` may collide at run time, and\n" +
      "deciding that needs the data.\n\n" +
      "This is a warning today and an error in a later version.",
  },

  /**
   * Read from the PARENT, because the fault belongs to neither child on its own.
   *
   * Each of them is a perfectly good element with a perfectly good key; what is wrong is that they
   * are siblings. So the parent is asked about its own children, which is also what makes "among
   * siblings" exact rather than approximate — a key repeated under a different parent never comes
   * into it.
   */
  read(element, { children }) {
    const seen = new Map<string, true>();
    const found: DuplicateKeyAmongSiblingsIssue[] = [];

    for (const child of children) {
      if (!ts.isJsxElement(child) && !ts.isJsxSelfClosingElement(child)) continue;

      const key = literalKey(child);
      if (key === undefined) continue;

      if (seen.has(key)) {
        found.push({
          key,
          tag: openingOf(child).tagName.getText(),
          ...positionOf(openingOf(child)),
        });
        continue;
      }
      seen.set(key, true);
    }

    return found;
  },
} as const satisfies ElementRule<DuplicateKeyAmongSiblingsIssue>;
