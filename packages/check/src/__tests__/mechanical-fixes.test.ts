import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";
import type { TextEdit } from "../rules/rule";

const here = dirname(fileURLToPath(import.meta.url));

/** Every finding in the fixture, flattened, because the question is about the whole run. */
const reported = () => {
  const findings = analyzeProject(join(here, "fixtures", "mechanical-fixes", "tsconfig.json")).findings;
  return Object.entries(findings)
    .flatMap(([id, issues]) => (issues as readonly { line: number; edit?: TextEdit }[]).map((i) => ({ id, ...i })))
    .sort((a, b) => a.line - b.line);
};

/**
 * The line between a fault the checker can fix and one it can only describe.
 *
 * This is the test that matters for `--fix`. Every rule below reports both kinds, so a rule that
 * started carrying an edit for the wrong one would look exactly like a rule working — its report
 * would be unchanged, its tests would pass, and the only visible difference would be somebody's
 * code being rewritten wrongly.
 */
describe("which faults carry an answer and which only carry advice", () => {
  test("the four with a single answer carry the edit that applies it", () => {
    const fixable = reported()
      .filter((issue) => issue.edit !== undefined)
      .map((issue) => `${issue.line}:${issue.edit?.says}`);

    expect(fixable).toEqual([
      "17:`class` → `className`",
      "26:`httpEquiv` → `http-equiv`",
      "31:`aria-labelledBy` → `aria-labelledby`",
      '36:`disabled="false"` → `disabled={false}`',
    ]);
  });

  /**
   * Five faults reported with no edit, each for its own reason, and none of them "hard to do".
   *
   * 19 has `class` AND `className`: which one they meant to keep is not written down. 23 is a
   * COMPONENT, where the rename reaches the prop and the answer is in that component's own file.
   * 28 is `innerHTML`, whose answer is "put it in the children" — a change of shape, not a span.
   * 33 is one edit from a real ARIA name, which is a GUESS and says so with a question mark. 40
   * holds the string in a `const`, and whether that name has to stay a string elsewhere is not
   * knowable from the line.
   */
  test("and the ones whose answer needs a person are reported without one", () => {
    const advisedOnly = reported()
      .filter((issue) => issue.edit === undefined && issue.id !== "reference-to-an-id-that-is-not-there")
      .map((issue) => `${issue.line}:${issue.id}`);

    expect(advisedOnly).toEqual([
      "19:class-instead-of-classname",
      "23:class-instead-of-classname",
      "28:attribute-that-does-nothing",
      "33:unknown-aria-attribute",
      "40:false-on-a-boolean-attribute",
    ]);
  });

  /**
   * `aria-labelledBy` is a fault in SVG and NOT in HTML, which is why 31 is an `<svg>`.
   *
   * `setAttribute` lowercases for HTML, so the attribute arrives correctly spelled and does its
   * job; `setAttributeNS` does not. An edit that fired on the HTML spelling would be rewriting
   * markup that works.
   */
  test("the case fix belongs to SVG, where the case is not corrected for you", () => {
    const onSvg = reported().find((issue) => issue.line === 31 && issue.id === "unknown-aria-attribute");

    expect(onSvg?.edit?.text).toBe("aria-labelledby");
  });
});
