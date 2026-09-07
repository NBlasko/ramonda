import { describe, expect, test } from "vitest";
import { block, toStyleObject } from "../value";

/**
 * The compiled value — the one shape the compiler emits and the only thing a `css` prop accepts.
 *
 * Nothing here is written by hand in an application. The compiler emits `block(…)` once at module
 * scope and a call at the site, so these tests are the contract two separate pieces of work are
 * being written against: the transform that emits it and the framework that applies it.
 */

describe("a block with no holes", () => {
  const flex = block("r-0123456789abcdef");

  test("is itself the value, so it costs one allocation for the life of the program", () => {
    // The compiler emits `css={_s0}` rather than `css={_s0()}` for exactly this. A call would build
    // an identical object on every render of every instance.
    expect(flex.className).toBe("r-0123456789abcdef");
    expect(flex.properties).toEqual([]);
    expect(flex.values).toEqual([]);
  });

  test("is the same object every time it is read", () => {
    expect(flex).toBe(flex);
  });

  test("still answers to a call, because a hole may be added later without changing the site", () => {
    expect(toStyleObject(flex())).toEqual({ className: "r-0123456789abcdef", style: {} });
  });
});

describe("a block with holes", () => {
  const bordered = block("r-fedcba9876543210", ["--r-fedcba9876543210-0", "--r-fedcba9876543210-1"]);

  test("carries the values in hole order, beside the names they belong to", () => {
    const value = bordered("4px solid #10b981", 24);

    expect(value.className).toBe("r-fedcba9876543210");
    expect(value.properties).toEqual(["--r-fedcba9876543210-0", "--r-fedcba9876543210-1"]);
    expect(value.values).toEqual(["4px solid #10b981", 24]);
  });

  test("builds a fresh value per call, because the values are per element", () => {
    expect(bordered("red", 1)).not.toBe(bordered("red", 1));
  });

  test("never concatenates: the expression's own value arrives untouched", () => {
    // This is why nothing has to be escaped at COMPILE time — the value is an argument, and the
    // compiler builds no string. What a renderer may do with it is `toStyleObject`'s problem, below.
    const hostile = '"; } body { display: none } .x {';
    expect(bordered(hostile, 0).values[0]).toBe(hostile);
  });

  test("the descriptor read without a call is a value with no values, which is how it is caught", () => {
    // `css={_s0}` on a block that HAS holes is the one misuse the shape has to remain able to
    // report. The runtime diagnostic is written later; the shape it needs exists now.
    expect(bordered.properties).toHaveLength(2);
    expect(bordered.values).toHaveLength(0);
  });
});

describe("the arity, which the compiler is checking against itself", () => {
  test("one argument per hole, taken from the property names", () => {
    const two = block("r-cccccccccccccccc", ["--r-cccccccccccccccc-0", "--r-cccccccccccccccc-1"]);

    // The compiler writes both halves — the names and the call — so emitting two names and one
    // argument stops being a shape that can reach a browser. `check-types` is the assertion here;
    // the expectation below is only what keeps the test from being empty at runtime.
    // @ts-expect-error a block with two holes cannot be called with one value
    expect(() => two("only one")).not.toThrow();

    // @ts-expect-error nor with three
    expect(() => two("a", "b", "c")).not.toThrow();

    expect(two("a", "b").values).toEqual(["a", "b"]);
  });
});

describe("the value as any other JSX library would spread it", () => {
  test("becomes a class and a style object", () => {
    const bordered = block("r-aaaaaaaaaaaaaaaa", ["--r-aaaaaaaaaaaaaaaa-0"]);

    expect(toStyleObject(bordered("#10b981"))).toEqual({
      className: "r-aaaaaaaaaaaaaaaa",
      style: { "--r-aaaaaaaaaaaaaaaa-0": "#10b981" },
    });
  });

  test("a number arrives as text, because a custom property holds text", () => {
    const padded = block("r-bbbbbbbbbbbbbbbb", ["--r-bbbbbbbbbbbbbbbb-0"]);

    expect(toStyleObject(padded(24)).style).toEqual({ "--r-bbbbbbbbbbbbbbbb-0": "24" });
  });

  /**
   * A value that would become a SECOND declaration is dropped.
   *
   * `setProperty` cannot create one whatever it is handed, but this object never reaches it: a
   * renderer spreads it, and a server-rendered page is serialized to HTML and parsed back — where
   * the grammar applies to whatever the serializer wrote. Measured through that round trip in the
   * framework's own suite, the value below came back as real, applied declarations.
   */
  test("a value carrying a semicolon is refused rather than passed on", () => {
    const bordered = block("r-cccccccccccccccc", ["--r-cccccccccccccccc-0", "--r-cccccccccccccccc-1"]);

    const { style } = toStyleObject(bordered("red; position: fixed; width: 100vw", "8px"));

    expect(style).toEqual({ "--r-cccccccccccccccc-1": "8px" });
  });

  /**
   * The same rule asked of a value that is not a string yet — the framework's own path had this
   * backwards and a measurement found it: `typeof value === "string"` was asked BEFORE the value
   * became text, so `{ toString: () => "red; position: fixed; …" }` went out unexamined and came
   * back off a server render as applied declarations. This path stringified first and so was never
   * exposed to that one, but it wrote every other kind through — and the kinds a hole is given by
   * mistake are text no property can parse.
   *
   * Both paths now answer it the same way: a string or a finite number, and nothing else.
   */
  test("a kind a custom property cannot hold is refused, semicolon or not", () => {
    const one = block("r-ffffffffffffffff", ["--r-ffffffffffffffff-0"]);
    const call = (value: unknown) => toStyleObject(one(value as string)).style;

    expect(call({ toString: () => "red; position: fixed" })).toEqual({});
    expect(call(true)).toEqual({});
    expect(call({})).toEqual({});
    expect(call(() => 1)).toEqual({});
    expect(call(Number.NaN)).toEqual({});
    expect(call(Number.POSITIVE_INFINITY)).toEqual({});
  });

  test("a descriptor read without a call has no values, so it contributes no declarations", () => {
    const bordered = block("r-dddddddddddddddd", ["--r-dddddddddddddddd-0"]);

    // `css={_s0}` on a block that HAS holes. A type error now — see the note below — and the runtime
    // tolerance is kept and asserted, because the types are not the only way in: the style is
    // missing rather than written as the text `"undefined"`, which CSS would keep.
    // @ts-expect-error a descriptor with holes is not a value — call it first
    expect(toStyleObject(bordered).style).toEqual({});
  });

  test("but a block with no holes IS the value, because there is nothing to call it with", () => {
    const plain = block("r-eeeeeeeeeeeeeeee");

    expect(toStyleObject(plain)).toEqual({ className: "r-eeeeeeeeeeeeeeee", style: {} });
  });

  test("the framework is not needed to read one", async () => {
    // The package may not import the framework, at any depth. The entry is loaded here on its own
    // and this file runs in vitest's `node` environment, so a reach for `document` would throw.
    const entry = await import("../index");
    expect(Object.keys(entry).sort()).toContain("block");
  });
});

/**
 * The adapter and the framework asked the same question, and answered it differently.
 *
 * `applyCssBlock` removes a property whose value is `null` — the declaration then falls back to what
 * the stylesheet said. This wrote the text `"null"` instead, and that is not the harmless version:
 * a `var()` that substitutes something the property cannot parse is invalid at COMPUTED-VALUE time,
 * which drops the declaration **and any earlier one for the same property** — measured in Chromium
 * for the glued-hole rule, and it is the same mechanism here.
 *
 * Two paths answering one question two ways, with one of them wrong: the recurring shape.
 */
describe("a value that is not a value", () => {
  const two = block("r-aaaaaaaaaaaaaaaa", ["--r-aaaaaaaaaaaaaaaa-0", "--r-aaaaaaaaaaaaaaaa-1"]);

  test("`null` is left out, exactly as the framework leaves it out", () => {
    const { style } = toStyleObject(two(null as never, "red"));

    expect(style).toEqual({ "--r-aaaaaaaaaaaaaaaa-1": "red" });
  });

  test("and so is `undefined`", () => {
    const { style } = toStyleObject(two(undefined as never, "red"));

    expect(style).toEqual({ "--r-aaaaaaaaaaaaaaaa-1": "red" });
  });

  test("but zero is a value, and stays one", () => {
    const { style } = toStyleObject(two(0 as never, 4 as never));

    expect(style).toEqual({ "--r-aaaaaaaaaaaaaaaa-0": "0", "--r-aaaaaaaaaaaaaaaa-1": "4" });
  });

  /**
   * A descriptor read without being called is the fault the framework reports as `RMD062`. Nothing
   * here can report it — this package ships to a browser and imports nothing, so it has no
   * diagnostics — but the shape is a callable, and a type can see that.
   *
   * Measured before this: `toStyleObject(_s0)` type-checked, because a descriptor structurally IS a
   * `StyleValue`, and returned `{ className, style: {} }` — an element with the class, none of its
   * custom properties, and every declaration that reads one falling back. In silence, on the one
   * path where no diagnostic exists.
   */
  test("an uncalled descriptor is refused by the types", () => {
    // @ts-expect-error a descriptor is not a value — call it first
    toStyleObject(two);
  });
});
