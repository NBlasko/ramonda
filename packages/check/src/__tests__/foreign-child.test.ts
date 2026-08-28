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
    expect(said()).toContain("17:divinul");
  });

  test("and the containers the parser MOVES a foreign child out of", () => {
    // `<select>` and `<table>` have strict content models, so the tree the browser builds is not the
    // tree in the source — which hydration then reports as RMD007, a mismatch, sending the reader
    // after a clock that is not there.
    expect(said()).toContain("22:spaninselect");
    expect(said()).toContain("27:divintable");
    expect(said()).toContain("33:divintr");
  });

  test("two foreign children are two reports, because each is its own line to move", () => {
    expect(said()).toContain("39:divinol");
    expect(said()).toContain("40:spaninol");
  });

  test("the whole list, so a regression cannot go quiet", () => {
    expect(said()).toEqual([
      "17:divinul",
      "22:spaninselect",
      "27:divintable",
      "33:divintr",
      "39:divinol",
      "40:spaninol",
      // Words written straight inside are as foreign as a tag, and the whitespace between children
      // — a text node on every well-formed list there is — is not.
      "53:textinul",
    ]);
  });

  /**
   * The silences, and the second is what makes the rule shippable.
   *
   * 44 writes the right child. 49 builds from data and 52 holds a COMPONENT — that is how every real
   * list is made, and either may render exactly the right tag, so only a tag written OUT and known
   * to be wrong is reported.
   *
   * 57 is the well-formed list, and it is the one this rule would break first if the text case were
   * written carelessly: every container here spans several lines, so the newline and the
   * indentation between children are JSX text nodes on every correct list in existence.
   *
   * The rest are the CONTAINERS, each holding tags it takes beside its main one — which are in the
   * table rather than assumed away: 68 a `<table>` with a caption, a colgroup, a thead and a
   * tbody; 84 a `<select>` and 85 the `<optgroup>` inside it, which takes options; 93 a `<dl>`
   * with both its tags and 96 the `<div>` wrapper the specification allows in one; 103 a
   * `<picture>` with a source and an image.
   *
   * Each is the line the rule would REPORT if it were wrong. Three of these used to name a
   * comment, a closing tag and a blank line, so four of the silences here were never checked —
   * which is what a negative assertion costs when it points at nothing.
   */
  test("the right children, and everything this cannot see, stay silent", () => {
    const lines = found().map((issue) => issue.line);
    for (const quiet of [44, 49, 57, 63, 68, 84, 85, 93, 96, 103]) {
      expect(lines, `line ${quiet} should be silent`).not.toContain(quiet);
    }
  });
});
