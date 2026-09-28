import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { GRAMMAR_SHAPES } from "../compiler/grammarShapes.generated";
import { SHAPES } from "../compiler/shapes.generated";

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

  test("and the two added up, which is what a reader takes away", () => {
    expect(claimed(/they answer \*\*(\d+) families\*\*/)).toBe(
      Object.keys(SHAPES).length + Object.keys(GRAMMAR_SHAPES).length,
    );
  });
});

/**
 * The families the page names as refused, against the tables.
 *
 * Named rather than counted, because a reader meeting a refusal looks for the family by name. A
 * family that starts splitting and stays on this list sends them to work around something that
 * already works.
 */
describe("the families the map says are refused", () => {
  const named = (heading: string): readonly string[] => {
    const found = new RegExp(`\\*\\*${heading}[^*]*\\*\\*[^:]*:?([^.]*)\\.`, "s").exec(map);
    if (found === null) throw new Error(`CONTRIBUTING.md no longer lists the families under "${heading}"`);
    return [...(found[1] ?? "").matchAll(/`([a-z-]+)`/g)].map((one) => one[1] as string);
  };

  test("none of them is in a table", () => {
    const listed = [...named("Nine have a grammar"), ...named("Twelve open and the measurement")];

    expect(listed.filter((one) => GRAMMAR_SHAPES[one] !== undefined || SHAPES[one] !== undefined)).toEqual([]);
  });

  test("and the page names as many as it counts", () => {
    expect(named("Nine have a grammar")).toHaveLength(9);
    expect(named("Twelve open and the measurement")).toHaveLength(12);
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
