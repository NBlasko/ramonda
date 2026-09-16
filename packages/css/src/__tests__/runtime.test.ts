import { afterEach, describe, expect, expectTypeOf, test } from "vitest";
import type { Token } from "../token";
import type { CssColor } from "../values.generated";
import type { CssDimension } from "../units.generated";
import { read, toStyle } from "../value";

/**
 * The two things a project does with a declared variable OUTSIDE a block.
 *
 * `$` in a block is compiled away and never reaches the browser. These are the other half: a theme
 * whose values arrive at run time, and the rare read back out. Both are the user's own logic — this
 * package owes them the names and the types, not the theming.
 */

/**
 * Stand-ins for what codegen writes, which is a branded string and nothing else.
 *
 * Their ranges are OPEN — `CssColor`, `CssDimension` — because these stand for variables a project
 * means to set at run time, and a variable that declared a single value means it never changes.
 * `toStyle` holds a token to its own range, so a fixed one cannot be set at all, which is the whole
 * point of declaring it fixed.
 */
const colour = "var(--color-primary-main)" as Token<"color", CssColor>;
const length = "var(--size-control-md)" as Token<"length", CssDimension>;
const digits = "var(--space-inline-2xl)" as Token<"length", CssDimension>;

describe("toStyle", () => {
  test("turns variables into the custom properties an element carries", () => {
    expect(
      toStyle([
        [colour, "#7c3aed"],
        [length, "24px"],
      ]),
    ).toEqual({ "--color-primary-main": "#7c3aed", "--size-control-md": "24px" });
  });

  test("a name with digits in it survives, because our own grammar allows one", () => {
    expect(toStyle([[digits, "64px"]])).toEqual({ "--space-inline-2xl": "64px" });
  });

  test("nothing to set is an empty object, not undefined — it is spread into `style`", () => {
    expect(toStyle([])).toEqual({});
  });

  test('a number is written as one, so `700` does not become `"700"` by accident', () => {
    const weight = "var(--weight-bold)" as Token<"number", number>;

    expect(toStyle([[weight, 400]])).toEqual({ "--weight-bold": "400" });
  });

  test("the value has to suit the variable's KIND, which is the whole point of typing it", () => {
    // @ts-expect-error — a length where a colour was declared
    toStyle([[colour, "30px"]]);

    // @ts-expect-error — a colour where a length was declared
    toStyle([[length, "#3b82f6"]]);

    // and the ones that fit stay fitting
    toStyle([
      [colour, "rebeccapurple"],
      [length, "calc(1rem + 2px)"],
    ]);
  });
});

describe("read", () => {
  const stub = (values: Record<string, string>) => {
    (globalThis as { getComputedStyle?: unknown }).getComputedStyle = () => ({
      getPropertyValue: (name: string) => values[name] ?? "",
    });
  };

  afterEach(() => {
    (globalThis as { getComputedStyle?: unknown }).getComputedStyle = undefined;
  });

  test("reads the variable the token names, from the element it is asked about", () => {
    stub({ "--color-primary-main": "rgb(124, 58, 237)" });

    expect(read(colour, {} as Element)).toBe("rgb(124, 58, 237)");
  });

  test("the value comes back trimmed, because CSS keeps the author's spaces", () => {
    stub({ "--size-control-md": "   30px  " });

    expect(read(length, {} as Element)).toBe("30px");
  });

  /**
   * Empty means the STYLESHEET is not loaded, and saying so is better than inventing a value.
   *
   * A declared variable is registered with `@property { initial-value }`, and measured in Chrome
   * that resolves even when nothing sets the name — so an empty read cannot mean "unset". It means
   * the generated stylesheet never arrived, which is a setup fault a person should meet.
   */
  test("a variable nothing set reads as empty rather than as a guess", () => {
    stub({});

    expect(read(colour, {} as Element)).toBe("");
  });

  test("the return is a string, never the token's own type", () => {
    stub({ "--color-primary-main": "rgb(0, 0, 0)" });

    expectTypeOf(read(colour, {} as Element)).toEqualTypeOf<string>();
  });
});

/**
 * A variable that declared a RANGE is held to it, which is what a range is for.
 *
 * Binding the kind alone let any colour into any colour variable. A variable a theme moves between
 * two colours means those two, and setting a third at run time is the mistake this catches.
 */
describe("toStyle against a variable's range", () => {
  const themed = "var(--color-text-primary)" as Token<"color", "#111827" | "#e5e7eb">;
  const open = "var(--color-brand-main)" as Token<"color", `#${string}`>;

  test("a value from the range goes in", () => {
    expect(toStyle([[themed, "#e5e7eb"]])).toEqual({ "--color-text-primary": "#e5e7eb" });
  });

  test("one outside it does not", () => {
    // @ts-expect-error — the variable declared two colours and this is a third
    toStyle([[themed, "#ff0000"]]);
  });

  test("a variable with an open range takes any value of its kind", () => {
    expect(toStyle([[open, "#7c3aed"]])).toEqual({ "--color-brand-main": "#7c3aed" });
  });

  test("and the kind is still checked, which it was before", () => {
    // @ts-expect-error — a length where a colour was declared
    toStyle([[themed, "30px"]]);
  });
});
