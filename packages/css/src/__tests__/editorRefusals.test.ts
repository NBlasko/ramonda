import { describe, expect, test } from "vitest";
import { checkSource } from "../compiler/source";

/**
 * What the build REFUSES, said in the editor too.
 *
 * An editor reads a block forgivingly, so a half-typed line still completes — and so a block the
 * build refuses outright came back clean: `else` first in a block, `when $(a) $(b)`, a condition
 * inside a match arm. The build stopped with a sentence, the editor showed nothing until it ran.
 * The editor now asks the same strict reader the build does and shows ITS sentence, so the two can
 * never say different things about one block.
 */

const editor = (css: string) =>
  checkSource(
    `declare const a: boolean;\ndeclare const b: boolean;\nconst x = @@(\n${css}\n);\nexport default x;\n`,
    "/A.tsx",
    {
      tolerant: true,
    },
  );
const source = (css: string) =>
  `declare const a: boolean;\ndeclare const b: boolean;\nconst x = @@(\n${css}\n);\nexport default x;\n`;

describe("a refusal the build makes is a finding in the editor", () => {
  test.each([
    ["an `else` with nothing before it", "  else { color: red; }", "`else` belongs right after", "else"],
    ["a condition with two escapes", "  when $(a) $(b) { color: red; }", "takes one `$( … )`", "when"],
    [
      "a condition inside a match arm",
      "  match $(a) {\n    x => ( when $(b) { color: red; } );\n  }",
      "an arm holds declarations",
      "when",
    ],
    ["a choice with no `:`", "  color: $(a) ? red;", "`$( … ) ? a : b`", "$(a)"],
    ["an arm with no parens", "  match $(a) {\n    x => color: red;;\n  }", "`key => ( … );`", "x"],
    ["the old spelling of a condition", "  if ({a}) { color: red; }", "`when $( … )", "if"],
    ["a `$` on its own, with no config to name it", "  color: $;", "`$group.name`", "$"],
  ])("%s", (_what, css, says, at) => {
    const found = editor(css).filter((one) => one.rule === "block-refused");

    expect(found).toHaveLength(1);
    expect(found[0].message).toContain(says);
    expect(source(css).slice(found[0].at, found[0].at + at.length)).toBe(at);
  });

  test("a block the build compiles has none", () => {
    expect(editor("  when $(a) { color: red; } else { color: blue; }\n  color: $(b) ? red : blue;")).toEqual([]);
  });

  /** Where a rule already names the fault at that spot, it is said once — by the rule. */
  test.each([
    ["a hole as a whole declaration", "  $(a ? 1 : 2);", "hole-out-of-place"],
    ["a hole where a property name goes", "  $(a ? 1 : 2): red;", "hole-out-of-place"],
  ])("%s is said once, by its own rule", (_what, css, rule) => {
    const rules = editor(css).map((one) => one.rule);

    expect(rules).toContain(rule);
    expect(rules).not.toContain("block-refused");
  });

  /** The build refuses whatever a comment says, so the editor may not be quieter than it. */
  test("a directive does not silence it", () => {
    const css = "  /* ramonda-css-ignore block-refused: trying */\n  else { color: red; }";

    expect(editor(css).map((one) => one.rule)).toContain("block-refused");
  });

  /** The build itself still stops: the finding is the editor's, the refusal is the build's. */
  test("a strict read still refuses, as the build does", () => {
    expect(() => checkSource(source("  else { color: red; }"), "/A.tsx")).toThrow("`else` belongs right after");
  });
});
