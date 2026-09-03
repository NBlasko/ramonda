import { describe, expect, test } from "vitest";
import { arePropsBagsEqual } from "../helpers/arePropsBagsEqual";

/**
 * The comparison that decides whether a component is updated at all, tested directly.
 *
 * It had no test of its own — it was exercised only through component behaviour — and its contract
 * just changed: `ref` used to be left out of both the key COUNT and the value comparison, and is now
 * an ordinary prop. The four TextArea tests cover what that does to a page; these cover what the
 * function means, which is what the next reader needs.
 *
 * Every case below was decided by what `ref` is: an identity the caller keeps. A changed one is a
 * reason to do the work, and a `ref` appearing or disappearing is a change like any other — that
 * second half was invisible before, because subtracting it from both counts made
 * `<Child ref={r} />` and `<Child />` the same shape.
 */
describe("arePropsBagsEqual", () => {
  test("two empty bags are equal", () => {
    expect(arePropsBagsEqual({}, {})).toBe(true);
  });

  test("the same keys with the same values are equal", () => {
    const shared = { a: 1 };
    expect(arePropsBagsEqual({ label: "x", conf: shared }, { label: "x", conf: shared })).toBe(true);
  });

  test("a different value is not equal, by identity rather than by contents", () => {
    expect(arePropsBagsEqual({ label: "x" }, { label: "y" })).toBe(false);
    // Two objects with the same contents are two values: that is the whole reason `@StableProps`
    // exists, and it is settled before this function is reached.
    expect(arePropsBagsEqual({ conf: { a: 1 } }, { conf: { a: 1 } })).toBe(false);
  });

  test("a different set of keys is not equal", () => {
    expect(arePropsBagsEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(arePropsBagsEqual({ a: 1, b: 2 }, { a: 1 })).toBe(false);
  });

  /** The contract change: `ref` is a prop. */
  test("a swapped ref is a change", () => {
    const first = { setCurrent() {} };
    const second = { setCurrent() {} };
    expect(arePropsBagsEqual({ value: "x", ref: first }, { value: "x", ref: second })).toBe(false);
    expect(arePropsBagsEqual({ value: "x", ref: first }, { value: "x", ref: first })).toBe(true);
  });

  /** And so is one appearing or disappearing, which used to read as the same shape. */
  test("a ref on one side only is a change", () => {
    const held = { setCurrent() {} };
    expect(arePropsBagsEqual({ value: "x", ref: held }, { value: "x" })).toBe(false);
    expect(arePropsBagsEqual({ value: "x" }, { value: "x", ref: held })).toBe(false);
  });

  /**
   * `key` is compared too, and for its own reason: a matched component always has an equal key,
   * because `areSimilarNodes` refuses a node whose key differs. Ignoring it would remove nothing
   * while adding a rule to remember.
   */
  test("key is compared like anything else", () => {
    expect(arePropsBagsEqual({ key: "a" }, { key: "b" })).toBe(false);
    expect(arePropsBagsEqual({ key: "a" }, { key: "a" })).toBe(true);
  });
});
