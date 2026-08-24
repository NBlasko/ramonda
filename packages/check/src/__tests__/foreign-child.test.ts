import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const found = () =>
  analyzeProject(join(here, "fixtures", "foreign-child", "tsconfig.json")).findings["parent-with-a-foreign-child"] ??
  [];
const said = () => found().map((issue) => `${issue.line}:${issue.child}in${issue.parent}`);

/**
 * A container whose children are fixed by the content model, holding something else.
 *
 * The MIRROR of `tag-needs-its-parent`, and neither answers the other: that one asks whether a child
 * is in the right parent, this asks whether a parent holds the right children. A `<div>` is legal
 * almost everywhere, so nothing about it is wrong until you see where it sits.
 *
 * A list is not styling, it is a COUNT: assistive technology announces "list, 5 items" and works
 * that out from the `<li>` children. A stray element breaks the run — the wrong number, or an early
 * end and a second list — and a reader told there are three items where there are seven is worse off
 * than one told nothing.
 *
 * Nobody writes it on purpose. It arrives when a row is wrapped for layout, and nothing on screen
 * changes because the CSS was on the row all along.
 */
describe("a container holding a tag that does not belong in it", () => {
  test("the wrapper that quietly ends a list", () => {
    expect(said()).toContain("19:divinul");
  });

  test("and the containers the parser MOVES a foreign child out of", () => {
    // `<select>` and `<table>` have strict content models, so the tree the browser builds is not the
    // tree in the source — which hydration then reports as RMD007, a mismatch, sending the reader
    // after a clock that is not there.
    expect(said()).toContain("24:spaninselect");
    expect(said()).toContain("29:divintable");
    expect(said()).toContain("35:divintr");
  });

  test("two foreign children are two reports, because each is its own line to move", () => {
    expect(said()).toContain("41:divinol");
    expect(said()).toContain("42:spaninol");
  });

  test("the whole list, so a regression cannot go quiet", () => {
    expect(said()).toEqual([
      "19:divinul",
      "24:spaninselect",
      "29:divintable",
      "35:divintr",
      "41:divinol",
      "42:spaninol",
    ]);
  });

  /**
   * The silences, and the second is what makes the rule shippable.
   *
   * 46 writes the right child. 51 builds from data and 54 holds a COMPONENT — that is how every real
   * list is made, and either may render exactly the right tag, so only a tag written OUT and known
   * to be wrong is reported.
   *
   * The rest are tags a container takes BESIDE its main one, which are in the table rather than
   * assumed away: a `<table>` with a caption, a colgroup, a thead and a tbody; a `<select>` with an
   * optgroup and an `<hr>`; a `<dl>` with both its tags and the `<div>` wrapper the specification
   * allows in one; a `<picture>` with a source and an image.
   */
  test("the right children, and everything this cannot see, stay silent", () => {
    const lines = found().map((issue) => issue.line);
    for (const quiet of [46, 51, 54, 59, 60, 61, 74, 78, 84, 92]) {
      expect(lines, `line ${quiet} should be silent`).not.toContain(quiet);
    }
  });
});
