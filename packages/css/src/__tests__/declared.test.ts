import { describe, expect, test } from "vitest";
import { IS_VARIABLE, isVariable, kind } from "../declared";

/**
 * `kind( … )` is the whole authoring surface for a project's variables, so this file is what decides
 * what a config may say.
 *
 * The asymmetry it is written around: a leaf that fails to be boxed is not an error anywhere later —
 * codegen simply does not see a variable there, emits nothing for it, and `$` has a hole where a
 * name should be. Nothing reports that. So every case below that asserts a leaf WAS boxed is
 * load-bearing, and the ones asserting a refusal are the cheap half.
 */

/** What a boxed leaf holds, read without depending on the symbol's spelling. */
const seen = (leaf: unknown) => (isVariable(leaf) ? { kind: leaf.kind, value: leaf.value } : leaf);

describe("kind()", () => {
  test("boxes every leaf of a flat group with the kind it was given", () => {
    const group = kind("color", { main: "#3b82f6", light: "#93c5fd" });

    expect(seen(group.main)).toEqual({ kind: "color", value: "#3b82f6" });
    expect(seen(group.light)).toEqual({ kind: "color", value: "#93c5fd" });
  });

  test("reaches all the way down, however deep the group is", () => {
    const group = kind("length", { control: { inner: { md: "30px" } } });

    expect(seen(group.control.inner.md)).toEqual({ kind: "length", value: "30px" });
  });

  test("a nested kind() keeps ITS kind rather than the outer one", () => {
    const group = kind("length", {
      control: { md: "30px" },
      weight: kind("number", { bold: 700 }),
    });

    expect(seen(group.control.md)).toEqual({ kind: "length", value: "30px" });
    expect(seen(group.weight.bold)).toEqual({ kind: "number", value: 700 });
  });

  test("does not mutate what it was given", () => {
    // `as const` because a group lifted out of the call widens to `{ main: string }` first — see the
    // note on `kind`. Inside a real config the group is written in the call and keeps its literals.
    const written = { main: "#3b82f6" } as const;
    kind("color", written);

    expect(written).toEqual({ main: "#3b82f6" });
    expect(isVariable((written as Record<string, unknown>).main)).toBe(false);
  });

  test("a number is a value, because `number` and `integer` are kinds", () => {
    expect(seen(kind("number", { bold: 700 }).bold)).toEqual({ kind: "number", value: 700 });
  });

  test("refuses a kind CSS does not register, and names the nearest one", () => {
    // @ts-expect-error — the point of the test is the JavaScript caller who has no types
    expect(() => kind("colour", { main: "#3b82f6" })).toThrow(/colour.*color/s);
  });

  test("refuses a leaf that is neither a value nor a group, and says where it was", () => {
    expect(() => kind("color", { brand: { main: null } } as never)).toThrow(/brand\.main/);
  });

  test("the marker is a registered symbol, so two copies of this package agree", () => {
    expect(IS_VARIABLE).toBe(Symbol.for("ramonda.css.variable"));
  });
});
