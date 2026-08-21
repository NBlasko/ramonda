import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = () => analyzeProject(join(here, "fixtures", "element-family", "tsconfig.json"));

/** The lines of the fixture each case is REPORTED on, so a report can be pinned to its own shape. */
const AT = {
  imageType: 37,
  hiddenButton: 50,
  hiddenOnlyChild: 67,
  levelOneHopAway: 98,
  levelWrittenAsText: 111,
  notAHeading: 129,
} as const;

const linesOf = (issues: readonly { line: number }[]) => issues.map((issue) => issue.line);

/**
 * Every reader an element rule has, asked the question `fixtures/one-hop` asked of `attr`.
 *
 * `attr` and `numberAttr` follow a name to its declaration. `stringAttr`, `trueAttr` and the id
 * table's own reader did not, and none of that is visible from any rule's source: each of them
 * calls a helper whose name says it reads the attribute. Four rules were affected and two of them
 * reported markup that is correct.
 */
describe("an attribute written one hop from where the rule looks", () => {
  test("`trueAttr` follows a name, so a hidden focusable is found either way", () => {
    const found = run().findings["aria-hidden-on-focusable"];

    // `aria-hidden="true"`, `aria-hidden={YES}` and the `tabIndex` one below them.
    expect(found).toHaveLength(3);
    expect(linesOf(found)).toContain(AT.hiddenButton);
  });

  test("and so does the heading whose only child is hidden a name away", () => {
    const found = run().findings["empty-heading-or-link"];

    expect(found).toHaveLength(2);
    expect(linesOf(found)).toContain(AT.hiddenOnlyChild);
  });

  /**
   * A heading's ROLE decides whether it is a heading at all, and reading only the literal made this
   * rule wrong in both directions at once: it missed `<div role={HEADING}>`, and it reported an
   * `<h3 role={PRESENTATION}>` that is not in the outline at runtime.
   */
  test("`stringAttr` follows a role, which decides whether the element is a heading", () => {
    const found = run().findings["heading-skips-a-level"];

    expect(linesOf(found)).toContain(AT.levelOneHopAway);
    expect(linesOf(found)).not.toContain(AT.notAHeading);
  });

  /** `aria-level="6"` is a number where it is written, and has to be the same one a name away. */
  test("a whole number written as a string is read through a name, as it is in place", () => {
    expect(linesOf(run().findings["heading-skips-a-level"])).toContain(AT.levelWrittenAsText);
  });

  /**
   * The id table reads an `<input type>` too, and reading only the literal made
   * `control-with-no-label` report an image input — which is named by its `alt` and belongs to
   * `unnamed-image`, where it is already reported.
   */
  test("the id table follows a name, so an image input is not also called an unlabelled control", () => {
    const found = run().findings["control-with-no-label"];

    expect(linesOf(found)).not.toContain(AT.imageType);
    expect(found).toHaveLength(0);
  });

  /** What already worked, kept so a change to the shared readers cannot take it away quietly. */
  test("the readers that already followed a name still do", () => {
    const findings = run().findings;

    expect(findings["aria-value"]).toHaveLength(4);
    expect(findings["role-takes-no-name"]).toHaveLength(3);
    expect(findings["role-missing-required-aria"]).toHaveLength(2);
    expect(findings["unnamed-image"]).toHaveLength(3);
    expect(findings["access-key"].map((issue) => issue.claimed)).toEqual(["a", "s"]);
    expect(findings["duplicate-id"]).toHaveLength(1);
  });
});
