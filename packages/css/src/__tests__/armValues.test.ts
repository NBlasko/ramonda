import { describe, expect, test } from "vitest";
import { checkSource } from "../compiler/source";

/**
 * The VALUE in a match arm and in a choice's branch, checked as the property's own value.
 *
 * Measured before this: `color: match $(t) { a => redd; }` and `color: $(on) ? redd : blue` were
 * silent, while `color: redd` alone is reported. The rules read a declaration's value parts, and an
 * arm's value was one part they stepped over. Types caught only a closed union like `display`'s.
 */

const findings = (css: string) =>
  checkSource(
    `declare const t: "a" | "b";\ndeclare const on: boolean;\nconst x = @@(\n${css}\n);\nexport default x;\n`,
    "/App.tsx",
  );
const rules = (css: string) => findings(css).map((one) => one.rule);
const covered = (css: string) => {
  const source = `declare const t: "a" | "b";\ndeclare const on: boolean;\nconst x = @@(\n${css}\n);\nexport default x;\n`;
  return checkSource(source, "/App.tsx").map((one) => source.slice(one.at, one.at + one.length));
};

describe("a wrong value is reported wherever it is written", () => {
  /** The baseline: the same value, written plainly, is reported — so the arms owe the same answer. */
  test("plainly", () => {
    expect(rules("  color: redd;")).not.toEqual([]);
  });

  test.each([
    ["a value match's arm", "  color: match $(t) { a => redd; b => blue; };"],
    ["a value match's `_` arm", "  color: match $(t) { a => red; _ => redd; };"],
    ["a choice's first branch", "  color: $(on) ? redd : blue;"],
    ["a choice's last branch", "  color: $(on) ? red : redd;"],
    ["a chain's middle branch", "  color: $(on) ? red : $(on) ? redd : blue;"],
    ["a block match's arm", "  match $(t) {\n    a => ( color: redd; );\n    b => ( color: blue; );\n  }"],
  ])("in %s", (_what, css) => {
    expect(rules(css)).toEqual(rules("  color: redd;"));
    expect(covered(css)).toEqual(["redd"]);
  });

  test("a unit the property does not take, in an arm", () => {
    expect(rules("  width: match $(t) { a => 10qq; b => 2px; };")).toContain("unknown-unit");
  });
});

describe("what arms must not be reported for", () => {
  test("two arms setting one property are not a repeat", () => {
    expect(rules("  color: match $(t) { a => red; b => red; };")).toEqual([]);
    expect(rules("  color: $(on) ? red : red;")).toEqual([]);
  });

  test("a declaration after a match is not an override out of order", () => {
    expect(rules("  color: match $(t) { a => red; b => blue; };\n  color: green;")).toEqual([]);
  });

  test("correct arms are quiet", () => {
    expect(rules("  border: match $(t) { a => 1px solid red; _ => none; };\n  display: $(on) ? flex : block;")).toEqual(
      [],
    );
  });

  /** A runtime value in an arm has its own rule; the arm's value check must not say it twice. */
  test("a hole in an arm is reported once, by its own rule", () => {
    expect(rules("  color: match $(t) { a => $(t); b => blue; };")).toEqual(["hole-in-a-match-arm"]);
    expect(rules("  color: $(on) ? $(t) : blue;")).toEqual(["hole-in-a-match-arm"]);
  });
});
