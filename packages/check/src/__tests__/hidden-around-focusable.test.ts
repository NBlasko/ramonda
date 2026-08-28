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
  /**
   * The one input a keyboard does not land on, and a child whose spread may settle it.
   *
   * Both were reported before this rule and `aria-hidden-on-focusable` shared a reader: it had its
   * own walk over the raw attributes, which accepted only a string literal for `type` and did not
   * ask about spreads at all. Two rules answering one question two different ways, and this was
   * the one that was wrong — 95 is the control, the same shape with a name that holds a real type.
   */
  test("a name is followed to the type it holds, and a child that spreads is not claimed", () => {
    expect(said()).toContain("95:input");
    const lines = found().map((issue) => issue.line);
    expect(lines, "an input typed `hidden` through a name is not focusable").not.toContain(90);
    expect(lines, "a child that spreads may carry the tabIndex that settles it").not.toContain(100);
  });

  test("a control inside, at one level and at two", () => {
    // 21 is the modal shape; 26 is an `<a href>` two elements down, which is how it really looks.
    expect(said()).toContain("21:button");
    expect(said()).toContain("26:a");
  });

  test("and something put in the tab order by hand, and the bare spelling of the attribute", () => {
    // `tabIndex={0}` makes a `<div>` focusable; a bare `aria-hidden` is `{true}` in JSX.
    expect(said()).toContain("34:div");
    expect(said()).toContain("39:input");
  });

  test("the whole list, so a regression cannot go quiet", () => {
    expect(said()).toEqual(["21:button", "26:a", "34:div", "39:input", "95:input"]);
  });

  /**
   * Eleven silences, and the two fixes are the first of them.
   *
   * 44 uses `inert`, which the platform added for exactly this and which does the focus half as
   * well. 49 takes the control out of the tab order by hand, which is the other fix — reporting it
   * would be reporting the fix. 56 has nothing focusable, 62 an `<a>` with no `href` and 67 an
   * `<input type="hidden">`, neither of which a keyboard lands on. 72 holds a COMPONENT and 77 an
   * expression, and guessing at what either renders is how a rule reports a page that is correct.
   * 80 cannot read the attribute and 85 says `false`.
   *
   * 90 and 100 are the two this rule used to report against, before it asked `inTheTabOrder`
   * instead of walking the attributes itself: an `<input>` whose `type` is held in a NAME that
   * means `hidden`, and a child that SPREADS, where `rest` may carry the `tabIndex={-1}` that
   * settles it. The sibling rule had both right all along.
   */
  test("both fixes, and everything this cannot see, stay silent", () => {
    const lines = found().map((issue) => issue.line);
    for (const quiet of [44, 49, 56, 62, 67, 72, 77, 80, 85, 90, 100]) {
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
