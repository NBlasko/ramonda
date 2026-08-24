import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const found = () =>
  analyzeProject(join(here, "fixtures", "hidden-around-focusable", "tsconfig.json")).findings[
    "aria-hidden-around-something-focusable"
  ] ?? [];
const said = () => found().map((issue) => `${issue.line}:${issue.inside}`);

/**
 * `aria-hidden="true"` wrapped around something a keyboard can still reach.
 *
 * `aria-hidden` takes a subtree out of the accessibility tree and does NOT take it out of the tab
 * order — nothing about it touches focus. So the control inside stays tabbable while ceasing to
 * exist for the software that would announce it.
 *
 * What that does is worse than either half alone: the reader presses Tab, focus moves, and their
 * screen reader says NOTHING, because there is no node left to describe. It is the one
 * accessibility fault that leaves somebody stranded rather than merely underserved — and the
 * commonest way to write it is a modal, where the page behind is hidden with one attribute and the
 * first Tab takes the reader out of the dialog and into a void.
 */
describe("a hidden subtree a keyboard can still tab into", () => {
  test("a control inside, at one level and at two", () => {
    // 19 is the modal shape; 24 is an `<a href>` two elements down, which is how it really looks.
    expect(said()).toContain("19:button");
    expect(said()).toContain("24:a");
  });

  test("and something put in the tab order by hand, and the bare spelling of the attribute", () => {
    // `tabIndex={0}` makes a `<div>` focusable; a bare `aria-hidden` is `{true}` in JSX.
    expect(said()).toContain("32:div");
    expect(said()).toContain("37:input");
  });

  test("the whole list, so a regression cannot go quiet", () => {
    expect(said()).toEqual(["19:button", "24:a", "32:div", "37:input"]);
  });

  /**
   * Nine silences, and the two fixes are the first of them.
   *
   * 42 uses `inert`, which the platform added for exactly this and which does the focus half as
   * well. 47 takes the control out of the tab order by hand, which is the other fix — reporting it
   * would be reporting the fix. 54 has nothing focusable, 60 an `<a>` with no `href` and 65 an
   * `<input type="hidden">`, neither of which a keyboard lands on. 70 holds a COMPONENT and 75 an
   * expression, and guessing at what either renders is how a rule reports a page that is correct.
   * 78 cannot read the attribute and 83 says `false`.
   */
  test("both fixes, and everything this cannot see, stay silent", () => {
    const lines = found().map((issue) => issue.line);
    for (const quiet of [42, 47, 54, 60, 65, 70, 75, 78, 83]) {
      expect(lines, `line ${quiet} should be silent`).not.toContain(quiet);
    }
  });

  /**
   * The sibling asks about the element CARRYING the attribute; this one asks about what is inside.
   *
   * Together they are the whole of the fault, and separately each is a sentence a reader can act on
   * — which is why they are two reports rather than one with a flag. Nothing here is reported twice.
   */
  test("and the sibling rule does not report the same lines", () => {
    const other =
      analyzeProject(join(here, "fixtures", "hidden-around-focusable", "tsconfig.json")).findings[
        "aria-hidden-on-focusable"
      ] ?? [];
    const mine = new Set(found().map((issue) => issue.line));
    for (const issue of other) expect(mine.has(issue.line)).toBe(false);
  });
});
