import { describe, expect, test } from "vitest";
import { check } from "./helpers";

/**
 * A declaration another declaration on the SAME element switches off.
 *
 * This is the one question ordinary CSS cannot ask. A stylesheet does not know which rules reach an
 * element, so nothing there can say *this line does nothing*; a block is one element's rule, so
 * here it is answerable — and what it catches is a broken LAYOUT rather than broken CSS.
 *
 * ## Why every list here was measured rather than recalled
 *
 * Asked of Chromium, each property beside `display: block` and beside the display that uses it.
 * **Four of the seventeen candidates ACT on a block container** — `align-content`, `justify-items`,
 * `place-items` and `place-content`, which modern engines apply to block layout — so a list written
 * from memory would have been four false reports. They are not in the table.
 *
 * ## And why silence is the default
 *
 * `flatten` drops a spread: `...$(base)` merges declarations this never sees. So the rule may only
 * read a disabling declaration that is PRESENT, never infer one from an absence — `top: 20px` alone
 * says nothing, because the block spread above it may be what positions the element.
 */
describe("a declaration another one on the same element switches off", () => {
  test.each([
    ["display: block; gap: 12px;", "gap"],
    ["display: block; justify-content: flex-end;", "justify-content"],
    ["display: block; flex-direction: column;", "flex-direction"],
    ["display: block; grid-template-columns: 1fr 1fr;", "grid-template-columns"],
    ["display: inline; row-gap: 12px;", "row-gap"],
    ["display: table; gap: 12px;", "gap"],
  ])("`%s` is reported on `%s`", (css, property) => {
    const found = check(css).filter((one) => one.rule === "declaration-does-nothing");

    expect(found).toHaveLength(1);
    expect(found[0].message).toContain(property);
    expect(found[0].message).toContain("display");
  });

  test.each([
    ["display: flex; gap: 12px;"],
    ["display: grid; gap: 12px;"],
    ["display: inline-flex; justify-content: flex-end;"],
    ["display: inline-grid; grid-template-rows: 40px;"],
    // Measured: a multi-column block uses `gap`, so the same pair is correct CSS here.
    ["display: block; columns: 2; gap: 12px;"],
    ["display: block; column-count: 2; gap: 12px;"],
    // Measured: these act on a block container, so reporting them would report correct CSS.
    ["display: block; align-content: flex-end;"],
    ["display: block; justify-items: end;"],
    ["display: block; place-items: end;"],
    ["display: block; place-content: end;"],
    // A spread may be what sets `display`, and this cannot see one.
    ["gap: 12px;"],
    // Nothing here knows what the hole holds, or what a global keyword resolves to.
    ["display: $(0); gap: 12px;"],
    ["display: inherit; gap: 12px;"],
    // An element with no box makes EVERY declaration inert; naming one of them would be noise.
    ["display: none; gap: 12px;"],
    ["display: contents; gap: 12px;"],
  ])("`%s` is silent", (css) => {
    expect(check(css).map((one) => one.rule)).not.toContain("declaration-does-nothing");
  });

  test.each([
    ["position: static; top: 20px;", "top"],
    ["position: static; inset: 20px;", "inset"],
    ["position: absolute; float: left;", "float"],
    ["position: fixed; float: right;", "float"],
    ["overflow: visible; resize: both;", "resize"],
    ["text-overflow: ellipsis; white-space: normal;", "text-overflow"],
    ["text-overflow: ellipsis; white-space: pre-wrap; overflow: hidden;", "text-overflow"],
    ["overflow: visible; white-space: nowrap; text-overflow: ellipsis;", "text-overflow"],
    ["width: 120px; height: 60px; aspect-ratio: 1 / 3;", "aspect-ratio"],
  ])("`%s` is reported on `%s`", (css, property) => {
    const found = check(css).filter((one) => one.rule === "declaration-does-nothing");

    expect(found).toHaveLength(1);
    expect(found[0].message).toContain(property);
  });

  test.each([
    ["position: relative; top: 20px;"],
    ["position: absolute; inset: 20px;"],
    ["position: static; float: left;"],
    ["overflow: auto; resize: both;"],
    ["overflow: hidden; white-space: nowrap; text-overflow: ellipsis;"],
    ["overflow: clip; white-space: pre; text-overflow: ellipsis;"],
    // `white-space` is INHERITED, so an absent one may be `nowrap` from an ancestor.
    ["overflow: hidden; text-overflow: ellipsis;"],
    ["width: 120px; aspect-ratio: 1 / 3;"],
    ["width: 120px; height: auto; aspect-ratio: 1 / 3;"],
    ["top: 20px;"],
    ["float: left;"],
    ["resize: both;"],
  ])("`%s` is silent", (css) => {
    expect(check(css).map((one) => one.rule)).not.toContain("declaration-does-nothing");
  });

  /**
   * Values a browser accepts that the first version of the table was wrong about.
   *
   * Each row here reported correct CSS until it was measured. A rule that fails a build has to be
   * wrong in the quiet direction, so every one of these is now silence.
   */
  test.each([
    // `-webkit-box` and its inline form lay out children and use `gap`; `flex` and `grid` are not
    // the only words that mean so.
    ["display: -webkit-box; gap: 12px;"],
    ["display: -webkit-inline-box; gap: 12px;"],
    ["display: -webkit-flex; justify-content: flex-end;"],
    // `aspect-ratio` applies whenever a size is not DEFINITE, and a percentage is not.
    ["width: 140px; height: 50%; aspect-ratio: 1 / 3;"],
    ["width: 140px; height: calc(50% - 2px); aspect-ratio: 1 / 3;"],
    ["width: 140px; height: min-content; aspect-ratio: 1 / 3;"],
    ["width: 140px; height: fit-content; aspect-ratio: 1 / 3;"],
    ["width: 140px; height: stretch; aspect-ratio: 1 / 3;"],
    // An `overflow` longhand written beside the shorthand is what the element really has.
    ["overflow: visible; overflow-x: auto; resize: both;"],
    ["overflow: visible; overflow-y: auto; resize: both;"],
    ["white-space: nowrap; overflow: visible; overflow-x: hidden; text-overflow: ellipsis;"],
  ])("`%s` is correct CSS and stays silent", (css) => {
    expect(check(css).map((one) => one.rule)).not.toContain("declaration-does-nothing");
  });

  /**
   * A neighbour the checker is already complaining about decides nothing.
   *
   * `display: bolck` is a typo, and the author may be about to write `flex` — in which case the
   * `gap` beside it is exactly right. Judging it from a word CSS does not have is speaking about a
   * declaration somebody is still fixing, which is the reading `unknown-property` already gives way
   * to elsewhere in this file.
   *
   * Only the `display` row needs it, and the asymmetry is the reason: a row that fires when the
   * value IS something — `position: static`, `overflow: visible` — already goes quiet on a typo,
   * because a misspelling is not that value either. `display` fires when the value is NOT flex or
   * grid, and a misspelling is not those either.
   */
  test.each([
    ["display: bolck; gap: 12px;"],
    ["display: blcok; justify-content: flex-end;"],
    ["display: flexx; grid-template-columns: 1fr;"],
    // The control for the shape above: a typo in a row that fires on a value it RECOGNISES.
    ["position: statik; top: 20px;"],
    ["overflow: visibl; resize: both;"],
  ])("`%s` names a value CSS does not have, so nothing beside it is judged", (css) => {
    expect(check(css).map((one) => one.rule)).not.toContain("declaration-does-nothing");
  });

  /** And a display CSS does have is still judged, including the vendor spellings. */
  test.each([
    ["display: block; gap: 12px;", true],
    ["display: table-cell; gap: 12px;", true],
    ["display: block !important; gap: 12px;", true],
    ["display: -webkit-box; gap: 12px;", false],
    ["display: block flex; gap: 12px;", false],
  ])("`%s` is reported: %s", (css, reported) => {
    expect(
      check(css)
        .map((one) => one.rule)
        .includes("declaration-does-nothing"),
    ).toBe(reported);
  });

  /**
   * The VALUE is read out of the canonical text, so the shapes that text can take are their own
   * question — separate from which properties the table names.
   */
  test.each([
    // A variable is a value nothing here can read, so nothing beside it is judged.
    ["display: var(--layout); gap: 12px;", false],
    ["position: var(--place); top: 20px;", false],
    // `!important` rides along in the value and must not hide the word that decides.
    ["display: flex !important; gap: 12px;", false],
    ["display: block !important; gap: 12px;", true],
    // Order between the two is CSS's business, not this rule's: they are one element's declarations.
    ["gap: 12px; display: block;", true],
    // The later of two wins, which is what the browser applies.
    ["display: block; display: flex; gap: 12px;", false],
    ["display: flex; display: block; gap: 12px;", true],
  ])("`%s` is reported: %s", (css, reported) => {
    expect(
      check(css)
        .map((one) => one.rule)
        .includes("declaration-does-nothing"),
    ).toBe(reported);
  });

  /** And the definite sizes still are, so narrowing did not empty the row. */
  test.each([["width: 140px; height: 4rem; aspect-ratio: 1 / 3;"], ["width: 140px; height: 0; aspect-ratio: 1 / 3;"]])(
    "`%s` is still reported",
    (css) => {
      expect(check(css).map((one) => one.rule)).toContain("declaration-does-nothing");
    },
  );

  /**
   * A nested rule is a different group, and that is deliberate.
   *
   * `&:hover` is the same ELEMENT, so a `display` in the base group really does decide a `gap`
   * written under the hover — but `& > span` is a different element and the same reading would be
   * wrong about it. Silence costs a report; the alternative costs a false one.
   */
  test("a declaration under a nested selector is not decided by the base group", () => {
    expect(check("display: block;\n&:hover { gap: 12px; }").map((one) => one.rule)).not.toContain(
      "declaration-does-nothing",
    );
  });

  test("but a nested rule that sets both is reported", () => {
    const found = check("&:hover { display: block; gap: 12px; }").filter(
      (one) => one.rule === "declaration-does-nothing",
    );

    expect(found).toHaveLength(1);
  });

  /** Two rows can fire on `text-overflow`, and one mistake is one report. */
  test("a declaration both of its neighbours switch off is reported once", () => {
    const found = check("text-overflow: ellipsis; white-space: normal; overflow: visible;").filter(
      (one) => one.rule === "declaration-does-nothing",
    );

    expect(found).toHaveLength(1);
  });

  test("the message says what to do about it", () => {
    const [found] = check("display: block; gap: 12px;").filter((one) => one.rule === "declaration-does-nothing");

    expect(found.message).toContain("does nothing");
    expect(found.message).toContain("display: block");
  });
});
