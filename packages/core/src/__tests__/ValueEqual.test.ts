import { describe, expect, test } from "vitest";
import { valueEqual } from "../helpers/valueEqual";

/**
 * The comparison behind `@StableProps` and behind RMD020/RMD022's "this was rebuilt in place".
 *
 * It is bounded in both directions because it runs on every render, and the direction it errs in is
 * the whole point: past a bound it must answer **different**. For `@StableProps` that means a fresh
 * reference — correct, just not optimal. For a diagnostic it means a finding that is reported rather
 * than one that is invented.
 *
 * The width bound did not do that. It compared the first fifty items and then answered TRUE for the
 * rest, which is a verdict from a sample: two sixty-item arrays differing only at index 55 came back
 * equal, so a declared prop was handed its previous value and the change disappeared with nothing
 * reported. Found from `@ramonda/form`, where `defaultValues` carries a record rather than a key.
 */
const row = (n: number, at = -1, what = "") => Array.from({ length: n }, (_, i) => (i === at ? what : `r${i}`));

describe("valueEqual", () => {
  test("equal contents are equal", () => {
    expect(valueEqual(["user", 1], ["user", 1])).toBe(true);
    expect(valueEqual({ a: 1, b: "x" }, { a: 1, b: "x" })).toBe(true);
    expect(valueEqual(["posts", { page: 1 }], ["posts", { page: 1 }])).toBe(true);
  });

  test("a difference is a difference", () => {
    expect(valueEqual(["user", 1], ["user", 2])).toBe(false);
    expect(valueEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(valueEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });

  test("the same object is equal to itself whatever its size", () => {
    // `Object.is` answers before any bound is consulted, so holding one array is never penalised.
    const wide = row(500);
    expect(valueEqual(wide, wide)).toBe(true);
  });

  test("a difference past the width is NOT called equal", () => {
    // The bug. Both arrays are sixty long and agree everywhere but index 55.
    expect(valueEqual(row(60), row(60, 55, "CHANGED"))).toBe(false);
  });

  test("two equal arrays wider than the bound are called different, which is the safe direction", () => {
    // Not "optimal" — a wide array gets a fresh reference every render. It is the answer the bounds
    // were always documented to give, and the one that cannot lose a change.
    expect(valueEqual(row(60), row(60))).toBe(false);
    // And at the bound itself the full comparison still runs.
    expect(valueEqual(row(50), row(50))).toBe(true);
    expect(valueEqual(row(50), row(50, 49, "CHANGED"))).toBe(false);
  });

  test("past the depth, different", () => {
    const deep = (e: string) => ({ a: { b: { c: e } } });
    // Default depth is 2, so `c` sits past it and the pair is called different even though it matches.
    expect(valueEqual(deep("same"), deep("same"))).toBe(false);
    // With room to reach it, they match.
    expect(valueEqual(deep("same"), deep("same"), 5)).toBe(true);
    expect(valueEqual(deep("one"), deep("two"), 5)).toBe(false);
  });

  test("anything that is not a plain object or an array compares by identity", () => {
    // A Date, a File, a class instance: one comparison rather than a walk of its internals.
    const when = new Date(0);
    expect(valueEqual(when, when)).toBe(true);
    expect(valueEqual(new Date(0), new Date(0))).toBe(false);
    expect(valueEqual(null, null)).toBe(true);
    expect(valueEqual([1], { 0: 1 })).toBe(false);
  });
});
