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
const seen = (leaf: unknown) =>
  isVariable(leaf)
    ? { kind: leaf.kind, value: leaf.value, ...(leaf.range === undefined ? {} : { range: leaf.range }) }
    : leaf;

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

/**
 * A variable that says what it MAY BE, beside what it starts as.
 *
 * The user's question, and the last hole in the theme story: a variable declared with one value has
 * that value in its type, and a theme replaces it — so the type claims something the browser will
 * not use. `{ value, range }` splits the two. `value` is what `:root` and `@property` get; `range`
 * is what the type carries, and therefore what a property's narrowing is checked against and what
 * `toStyle` will accept.
 */
describe("a variable with a range", () => {
  test("the initial value and the range are both kept", () => {
    const group = kind("color", {
      text: { primary: { value: "#111827", range: ["#111827", "#e5e7eb"] } },
    });

    expect(seen(group.text.primary)).toEqual({
      kind: "color",
      value: "#111827",
      range: ["#111827", "#e5e7eb"],
    });
  });

  test("`any` is a range too — it changes, and we do not pin it", () => {
    const group = kind("color", { brand: { main: { value: "#10b981", range: "any" } } });

    expect(seen(group.brand.main)).toEqual({ kind: "color", value: "#10b981", range: "any" });
  });

  test("a bare value still means it never changes", () => {
    expect(seen(kind("color", { fixed: "#fff" }).fixed)).toEqual({ kind: "color", value: "#fff" });
  });

  test("the range must hold the initial value, or the two disagree", () => {
    expect(() => kind("color", { text: { primary: { value: "#111827", range: ["#e5e7eb"] } } } as never)).toThrow(
      /text\.primary/,
    );
  });

  test("an empty range is refused, because it permits nothing at all", () => {
    expect(() => kind("color", { a: { value: "#fff", range: [] } } as never)).toThrow(/a\b/);
  });
});
