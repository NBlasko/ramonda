import { describe, expect, test } from "vitest";
import { compose, merge } from "../merge";

/**
 * Composition, which happens at the CALL SITE and nowhere else.
 *
 * A block compiles to a map from what a declaration sets to the class that sets it, and merging two
 * of them keeps, per thing set, the one written later. **That is the only way the call site can
 * decide anything**, and it was measured: the order of classes in a `class` attribute decides
 * nothing — the stylesheet's order does — so two whole-block classes cannot say which one wins.
 * Keeping one class per thing set means there is never a tie to break.
 *
 * What comes out is the value the framework already takes: a class string, property names, values.
 * Nothing in `@ramonda/core` changes for any of this.
 */
const CLASS = "r-1111111111111111";

describe("what a merge produces", () => {
  test("one map is that map, spelled as a value", () => {
    expect(merge({ display: "r-aaaaaaaaaaaaaaaa" })).toEqual({
      className: "r-aaaaaaaaaaaaaaaa",
      properties: [],
      values: [],
    });
  });

  test("two maps setting different things keep both", () => {
    const { className } = merge({ display: "r-aaaaaaaaaaaaaaaa" }, { color: "r-bbbbbbbbbbbbbbbb" });

    expect(className.split(" ").sort()).toEqual(["r-aaaaaaaaaaaaaaaa", "r-bbbbbbbbbbbbbbbb"]);
  });

  test("two maps setting the SAME thing keep the later one, and only it", () => {
    const { className } = merge({ color: "r-aaaaaaaaaaaaaaaa" }, { color: "r-bbbbbbbbbbbbbbbb" });

    expect(className).toBe("r-bbbbbbbbbbbbbbbb");
  });

  test("a falsy argument is a group that is switched off", () => {
    const on = { opacity: "r-bbbbbbbbbbbbbbbb" };
    const base = { display: "r-aaaaaaaaaaaaaaaa" };
    /** What `disabled && block` compiles to, with the condition where a condition really is. */
    const when = (condition: boolean) => merge(base, condition && on).className;

    expect(when(false)).toBe("r-aaaaaaaaaaaaaaaa");
    expect(when(true).split(" ")).toHaveLength(2);
    expect(merge(base, undefined, null).className).toBe("r-aaaaaaaaaaaaaaaa");
  });

  test("and no arguments at all is a value that styles nothing", () => {
    expect(merge()).toEqual({ className: "", properties: [], values: [] });
  });
});

describe("a hole's value, which travels with its class", () => {
  test("becomes a custom property named after that class", () => {
    expect(merge({ color: [CLASS, "#10b981"] })).toEqual({
      className: CLASS,
      properties: [`--${CLASS}-0`],
      values: ["#10b981"],
    });
  });

  test("a declaration with two holes numbers them in order", () => {
    const { properties, values } = merge({ "border-left": [CLASS, "4px", "red"] });

    expect(properties).toEqual([`--${CLASS}-0`, `--${CLASS}-1`]);
    expect(values).toEqual(["4px", "red"]);
  });

  test("and a later map's value replaces an earlier one for the same thing", () => {
    const { className, properties, values } = merge({ color: [CLASS, "red"] }, { color: [CLASS, "blue"] });

    expect(className).toBe(CLASS);
    expect(properties).toEqual([`--${CLASS}-0`]);
    expect(values).toEqual(["blue"]);
  });

  test("a value that is not carried at all leaves the property unset", () => {
    // The same rule `toStyleObject` and the framework follow: no value means the declaration falls
    // back to what the stylesheet said, rather than being written as the text `"null"`.
    const { properties, values } = merge({ color: [CLASS, null as never] });

    expect(properties).toEqual([]);
    expect(values).toEqual([]);
  });
});

/**
 * A shorthand and its longhand are DIFFERENT things set, so a merge keeps both and the STYLESHEET
 * breaks the tie — measured, and possibly against the call site. So the merge does what CSS's own
 * cascade does: a later shorthand clears its own longhands.
 *
 * **The list travels with the block that needs it**, under a key beginning with `~`, which no CSS
 * property may begin with. That is what keeps a table of 78 shorthands out of every page: a block
 * pays for the shorthands it actually writes and nothing else.
 */
describe("a shorthand meeting its own longhand", () => {
  const PADDING = "r-2222222222222222";
  const LEFT = "r-3333333333333333";
  const shorthand = { padding: PADDING, "~padding": ["padding-top", "padding-left"] };
  const longhand = { "padding-left": LEFT };

  test("a later shorthand clears it, which is what CSS says", () => {
    expect(merge(longhand, shorthand).className).toBe(PADDING);
  });

  test("an earlier one does not, because the sheet emits the longhand after it", () => {
    const { className } = merge(shorthand, longhand);

    expect(className.split(" ").sort()).toEqual([LEFT, PADDING].sort());
  });

  test("the list itself never reaches the element", () => {
    expect(merge(shorthand).className).toBe(PADDING);
  });

  /**
   * `compose` is the primitive and `merge` is the boundary: one composes with itself, the other
   * produces the value the framework takes and cannot be composed again. A nested group composes, so
   * this is the property that lets a nested `@@if` mean what a flattened one means.
   */
  test("and clearing is associative, which is what lets a group nest", () => {
    const other = { "padding-top": "r-4444444444444444" };
    const flat = merge(other, longhand, shorthand).className;

    expect(merge(other, compose(longhand, shorthand)).className).toBe(flat);
    expect(merge(compose(other, longhand), shorthand).className).toBe(flat);
    expect(merge(compose(compose(other, longhand), shorthand)).className).toBe(flat);
  });
});

/**
 * A clear-list names full KEYS, not property names, and both halves of that were nearly wrong.
 *
 * A key carries the context it was written in, so `padding` inside a `@media` clears `padding-left`
 * inside THAT `@media` and leaves the one outside it alone — they are different declarations on
 * different conditions and neither replaces the other. And a key may contain spaces, so a list
 * joined by one could not be split back.
 */
describe("clearing inside a condition", () => {
  const WIDE = "@media (min-width: 40rem)";

  test("clears only what shares its context", () => {
    const outside = { "padding-left": "r-outside00000000" };
    const inside = {
      [`${WIDE}|padding`]: "r-inside000000000",
      [`~${WIDE}|padding`]: [`${WIDE}|padding-left`],
    };

    const { className } = merge(outside, { [`${WIDE}|padding-left`]: "r-innerleft000000" }, inside);

    expect(className.split(" ").sort()).toEqual(["r-inside000000000", "r-outside00000000"]);
  });

  test("and a key holding a space survives being a list entry", () => {
    const map = {
      [`${WIDE}|padding`]: "r-aaaaaaaaaaaaaaaa",
      [`~${WIDE}|padding`]: [`${WIDE}|padding-left`],
    };

    expect(merge({ [`${WIDE}|padding-left`]: "r-bbbbbbbbbbbbbbbb" }, map).className).toBe("r-aaaaaaaaaaaaaaaa");
  });
});

/**
 * A merged VALUE, spread back into another merge — which is what `...{{base}};` does.
 *
 * `const base = @@( … )` compiles to a merged value, not to a map, because that is what the `css`
 * prop takes. So a spread of it hands `merge` the value, and a value has none of the keys a map has.
 *
 * **Measured before this existed, and it failed in the worst way — quietly and only sometimes:** a
 * base spread into a modifier still produced a plausible class string, because iterating a value's
 * own keys happens to yield its `className`. What it lost was the map, so nothing could be
 * overridden and nothing could be cleared — `padding: 8px` in the modifier left the base's
 * `padding-left: 40px` standing.
 *
 * So a value carries the map it came from, and `compose` reads it back.
 */
describe("a value spread back in", () => {
  const base = { "padding-left": "r-left0000000000000", cursor: "r-pointer000000000" };
  const roomy = { padding: "r-padding000000000", "~padding": ["padding-left"] };

  test("composes as the map it came from", () => {
    const value = merge(base);

    expect(merge(value, roomy).className).toBe("r-pointer000000000 r-padding000000000");
  });

  test("and so does one that was composed already", () => {
    const value = merge(base, { opacity: "r-opacity000000000" });

    expect(merge(value, roomy).className.split(" ").sort()).toEqual(
      ["r-pointer000000000", "r-opacity000000000", "r-padding000000000"].sort(),
    );
  });

  test("which is the same answer as merging the maps directly", () => {
    expect(merge(merge(base), roomy).className).toBe(merge(base, roomy).className);
  });
});
