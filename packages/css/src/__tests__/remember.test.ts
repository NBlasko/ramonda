import { describe, expect, test } from "vitest";
import { remember } from "../compiler/remember";
import { splitOf } from "../compiler/split";

describe("remember", () => {
  test("answers each input once", () => {
    let asked = 0;
    const length = remember(10, (property: string, value: string) => {
      asked++;
      return property.length + value.length;
    });

    expect([length("margin", "4px"), length("margin", "4px"), length("gap", "")]).toEqual([9, 9, 3]);
    expect(asked).toBe(2);
  });

  /**
   * A function of the property alone, handed to `map` — which passes the index as well. Read as the
   * value, the index made every position a new input: `["a", "a"].map(…)` was asked twice.
   */
  test("ignores what a caller passes past the inputs the answer takes", () => {
    let asked = 0;
    // Declared the way `writableProperty` is, which is what lets `map` take it.
    const same: (property: string) => string = remember(10, (property: string) => {
      asked++;
      return property;
    });

    expect(["margin", "margin"].map(same)).toEqual(["margin", "margin"]);
    expect(asked).toBe(1);
  });

  /** Every caller gets the same object, so one that changed it would change it for the next file. */
  test("hands back an answer nobody can change", () => {
    const first = splitOf("margin", "4px 8px");

    expect(first).toBe(splitOf("margin", "4px 8px"));
    expect(Object.isFrozen(first)).toBe(true);
  });

  /** A dev server runs for hours; the table is emptied rather than left to grow. */
  test("forgets everything past its limit, and still answers", () => {
    let asked = 0;
    const same = remember(2, (property: string) => {
      asked++;
      return property;
    });

    for (const one of ["a", "b", "c", "a"]) same(one);

    expect(asked).toBe(4);
    expect(same("c")).toBe("c");
  });
});
