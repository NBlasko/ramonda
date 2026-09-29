import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { GRAMMAR_SHAPES } from "../compiler/grammarShapes.generated";
import { SHAPES } from "../compiler/shapes.generated";
import { BY_HAND } from "../compiler/splitByHand";
import { SHORTHANDS } from "../compiler/keywords.generated";

/**
 * The map's numbers, against the tables they describe.
 *
 * `CONTRIBUTING.md` tells a contributor how many families split and which ones do not, and nothing
 * watched it. It went stale the same day it was written — the table gained a family and the page
 * still said the old count, and said a family was out that had just come in.
 *
 * A number in prose is a claim like any other. These are the ones a reader would act on: how much
 * of CSS the package answers, and which families to expect a refusal from.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const map = readFileSync(join(HERE, "..", "..", "CONTRIBUTING.md"), "utf8");

/** Every number the page states, so a changed table is heard here rather than by a reader. */
const claimed = (pattern: RegExp): number => {
  const found = pattern.exec(map);
  if (found === null) throw new Error(`CONTRIBUTING.md no longer says anything matching ${pattern}`);
  return Number(found[1]);
};

describe("what the map claims about the tables", () => {
  test("the positional count", () => {
    expect(claimed(/\*\*(\d+) families\.\*\*/)).toBe(Object.keys(SHAPES).length);
  });

  test("the grammar count", () => {
    expect(claimed(/\*\*(\d+) families\*\*, including/)).toBe(Object.keys(GRAMMAR_SHAPES).length);
  });

  test("the count split by hand", () => {
    expect(claimed(/\*\*(\d+) by hand\.\*\*/)).toBe(Object.keys(BY_HAND).length);
  });

  test("and the three together, which is what a reader takes away", () => {
    // Distinct families: `background-position` is in `SHAPES` and split by hand both.
    expect(claimed(/they answer \*\*(\d+) families\*\*/)).toBe(
      new Set([...Object.keys(SHAPES), ...Object.keys(GRAMMAR_SHAPES), ...Object.keys(BY_HAND)]).size,
    );
  });
});

/**
 * The page says every shorthand splits but `all` and `-webkit-mask`, and that is checked against
 * the tables rather than trusted: a family that stops splitting has to come back onto the page.
 */
describe("what the map says is left", () => {
  test("every shorthand splits, but the two the page names", () => {
    const left = Object.keys(SHORTHANDS).filter(
      (one) => SHAPES[one] === undefined && GRAMMAR_SHAPES[one] === undefined && BY_HAND[one] === undefined,
    );
    expect(left.sort()).toEqual(["-webkit-mask", "all"]);
    expect(map).toContain("every shorthand there is, but `all` and\n`-webkit-mask`");
  });
});

/**
 * `animation` is the one family split with a value held back, so the page says so by name. It is
 * the case a reader is most likely to meet and the hardest to guess at from a refusal alone.
 */
describe("the value held back", () => {
  test("`animation` is in the table, and the page says which value it refuses", () => {
    expect(GRAMMAR_SHAPES.animation?.contested).toEqual(["auto"]);
    expect(map).toContain("`animation: auto`");
  });
});
