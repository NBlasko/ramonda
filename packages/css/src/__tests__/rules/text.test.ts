import { checkBlock } from "../../compiler/rules";
import { describe, expect, test } from "vitest";
import { findBlocks } from "../../compiler/scan";
import { readBlock } from "../../compiler/read";
import { check, rules } from "./helpers";

/**
 * Two declarations run together, which is what a missing `;` makes of them.
 *
 * ## The fault this exists for
 *
 * Reported from a real editor: a semicolon deleted mid-file and **nothing said anything**. Measured,
 * that is exactly right for most properties — `padding: 4px 0 border-left: 1px solid red` is one
 * value to the parser, and `padding` is not among the 123 properties whose values are a closed
 * union, so neither the type layer nor `unknown-value` has grounds to object. The browser drops the
 * declaration, both of them, and the page renders without the style.
 *
 * A colon inside a value is the tell, and it is a good one: CSS values do not contain bare colons.
 * The three places one legitimately appears — inside a string, inside `url( … )`, inside any other
 * function — are exactly where this does not look.
 */
describe("a declaration with no semicolon after it", () => {
  test("is reported on the name that got swallowed", () => {
    const [only, ...rest] = check(`padding: 4px 0\n  border-left: 1px solid red;`);

    expect(rest).toEqual([]);
    expect(only.rule).toBe("run-on-declaration");
    expect(only.message).toContain("border-left");
    expect(only.message).toContain("padding");
  });

  test.each([
    ["a url with a scheme", `background: url(https://example.com/a.png);`],
    ["a quoted colon", `content: "a: b";`],
    ["a colon in a function", `background: image-set(url(a.png) 1x);`],
    ["a media query in a nested rule", `@media (min-width: 40rem) { color: red; }`],
    ["an ordinary block", `display: flex;\n  gap: 8px;`],
  ])("%s is not one", (_what, css) => {
    expect(check(css).filter((finding) => finding.rule === "run-on-declaration")).toEqual([]);
  });

  /** The property before it may be one whose values ARE checked, and then both faults are true. */
  test("it is reported whatever the property's grammar", () => {
    const rules = check(`position: relative\n  color: red;`).map((finding) => finding.rule);

    expect(rules).toContain("run-on-declaration");
  });
});

describe("a missing semicolon reports once", () => {
  test("the run-on is reported and the value is not judged", () => {
    const [only, ...rest] = check(`gap: 8px\n  padding: 4px 0;`);

    expect(rest).toEqual([]);
    expect(only.rule).toBe("run-on-declaration");
  });

  test("and a value that is wrong on its own is still judged", () => {
    const [only, ...rest] = check(`gap: sideways;`);

    expect(rest).toEqual([]);
    expect(only.rule).toBe("unknown-value");
  });
});

/**
 * A declaration with no `;`, which CSS allows for the last one in a block and this does not.
 *
 * **Reported by a user, and the reason is what happens NEXT.** A declaration without its semicolon
 * swallows whatever is written under it — that is `run-on-declaration` — so a block that is legal
 * today makes a stranger's next edit report a fault on a line they did not touch:
 *
 *     padding: 8px          legal, and silent
 *     padding: 8px          somebody adds a line under it
 *     color: red            run-on-declaration, on THEIR line
 *
 * Every other declaration needs one and the formatter writes one, so requiring it costs nobody a
 * keystroke they were not already making.
 */
describe("a declaration with no semicolon", () => {
  test("the last one in a block is reported", () => {
    expect(rules("  color: red;\n  padding: 8px")).toEqual(["missing-semicolon"]);
  });

  test("and the last one in a NESTED rule, which is the same next edit", () => {
    expect(rules("  &:hover { color: red }")).toEqual(["missing-semicolon"]);
  });

  test("a terminated block is silent, which is the control", () => {
    expect(rules("  color: red;\n  padding: 8px;")).toEqual([]);
    expect(rules("  &:hover { color: red; }")).toEqual([]);
  });

  /**
   * **Quiet wherever another rule has already spoken about the same declaration.**
   *
   * A declaration with no `;` is sometimes wreckage — a run-on, a hole standing where a property
   * name goes, a string that was never closed and ate the rest of the block. Listing those shapes
   * was the first attempt and it kept finding another one; asking whether anything has been said
   * about the same span is the question that was actually being asked.
   */
  test.each([
    ["a run-on", "  padding: 8px\n  border-left: 4px solid red;", "run-on-declaration"],
    ["a string that is never closed", `  display: "flexx`, "string-not-allowed"],
    ["a hole where a property name goes", `  $(cond ? "display:flex" : "")`, "hole-out-of-place"],
  ])("%s is left to the rule that explains it", (_what, css, only) => {
    expect(rules(css)).toEqual([only]);
  });

  /**
   * A declaration with NO VALUE yet is the state an editor is in most — `padding: ` while it is
   * being typed. Saying so on every keystroke is noise, and the strict read refuses a valueless
   * declaration outright, so nothing reaches a build this way.
   */
  test("a half-typed declaration says nothing", () => {
    expect(rules("  padding:")).toEqual([]);
  });
});

/**
 * A CALL that is never closed, named where it opens.
 *
 * `content: url(;` is a missing `)`, and what the author was told had nothing to do with it. The
 * value scanner counts parens, and a block's own closer is a `)` like any other — so the value ran
 * past `)}` and swallowed whatever came next:
 *
 *     content: url(;      →  "`const d = (1 + 2)` is not a declaration"
 *                            reported on line 4, for a mistake on line 2
 *
 * The note that parked this said the parens are BALANCED so no cheap check exists. That is true of
 * the block and false of the DECLARATION: inside one, `url(` is short a `)` and counting says so —
 * as long as the count skips a string, which is what made a naive version wrong about
 * `url("a)b.png"`.
 */
describe("a call that is never closed", () => {
  const under = (css: string) => {
    const source = `<div className={@@(\n${css}\n)}>x</div>`;
    const [site] = findBlocks(source);
    const read = readBlock(source, site.open, "Card.tsx", { tolerant: true });
    return checkBlock(read.block, {});
  };

  test.each([
    ["a url", "  content: url(;"],
    ["a calc", "  width: calc(1px;"],
    ["a nested call", "  width: calc(min(1px, 2px;"],
  ])("%s is reported, with the call named", (_what, css) => {
    const found = under(css);

    expect(found.map((one) => one.rule)).toContain("unclosed-call");
    expect(found.find((one) => one.rule === "unclosed-call")?.message).toMatch(/\)/);
  });

  test("the message names the function, so the fix is where the fault is", () => {
    const [found] = under("  content: url(;").filter((one) => one.rule === "unclosed-call");

    expect(found.message).toContain("url(");
  });

  /**
   * A `)` inside a STRING is not structure, and this cuts both ways.
   *
   * `content: url("a)b.png";` really IS unclosed — the only `)` is inside the quotes, so the call
   * never closes and the report is right. I wrote this row the other way round first and the code
   * was correct; a naive count agrees with the wrong answer, which is why the string skip is the
   * thing being tested here rather than an implementation detail.
   */
  test("a closer inside a string does not close the call", () => {
    expect(under(`  content: url("a)b.png";`).map((one) => one.rule)).toContain("unclosed-call");
  });

  test.each([
    ["an opener inside a string", `  content: url("a(b.png");`],
    ["a closed call", "  content: url(a.png);"],
    ["nested and closed", "  width: calc(min(1px, 2px) + 3px);"],
    ["no call at all", "  padding: 8px;"],
  ])("%s is not reported (%#)", (_what, css) => {
    expect(under(css).map((one) => one.rule)).not.toContain("unclosed-call");
  });
});
