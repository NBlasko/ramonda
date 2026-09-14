import { describe, expect, test } from "vitest";
import { generate, namesIn, verifyNames } from "../codegen";
import { kind } from "../declared";

/**
 * What codegen writes from a project's declared variables, which is the whole reason the config
 * holds a fallback and a kind at all.
 *
 * The asymmetry: a variable that is declared and NOT emitted fails silently — `$` has a name for it,
 * the stylesheet has no declaration, and every use falls back. The fallback is what stops that being
 * a visual bug, which is exactly why it must not also be the thing that hides the omission. So every
 * case asserting something IS emitted is load-bearing.
 */

const simple = {
  color: kind("color", { primary: { main: "#3b82f6" } }),
  size: kind("length", { control: { md: "30px" } }),
};

describe("names", () => {
  test("a name is the path, joined with a dash, spelled as a custom property", () => {
    expect(namesIn(simple).map((one) => one.name)).toEqual(["--color-primary-main", "--size-control-md"]);
  });

  test("the order is the config's own, not the alphabet's", () => {
    const written = { zebra: kind("color", { a: "#fff" }), alpha: kind("color", { b: "#000" }) };

    expect(namesIn(written).map((one) => one.name)).toEqual(["--zebra-a", "--alpha-b"]);
  });

  test("two paths that spell one name are refused, and BOTH are named", () => {
    const clashing = {
      "a-b": kind("length", { c: "1px" }),
      a: kind("length", { "b-c": "2px" }),
    };

    // The walk answers and `verifyNames` decides — see its note. `generate` runs both.
    expect(() => verifyNames(namesIn(clashing))).toThrow(/--a-b-c/);
    expect(() => generate(clashing)).toThrow(/a-b\.c/);
    expect(() => generate(clashing)).toThrow(/a\.b-c/);
  });
});

describe("the stylesheet", () => {
  test("`:root` carries every variable with the fallback it was declared with", () => {
    const { css } = generate(simple);

    expect(css).toContain("--color-primary-main: #3b82f6;");
    expect(css).toContain("--size-control-md: 30px;");
  });

  test("each one registers with the kind's own syntax, and INHERITS", () => {
    const { css } = generate(simple);

    expect(css).toContain(
      `@property --size-control-md {\n  syntax: "<length>";\n  inherits: true;\n  initial-value: 30px;\n}`,
    );
  });

  test("`any` registers TOO — `*` refuses nothing, but it still guarantees a value", () => {
    const { css } = generate({ misc: kind("any", { whatever: "anything at all" }) });

    expect(css).toContain("--misc-whatever: anything at all;");
    expect(css).toContain(
      `@property --misc-whatever {\n  syntax: "*";\n  inherits: true;\n  initial-value: anything at all;\n}`,
    );
  });

  test("every declared variable is registered, because that is what makes a bare `var()` safe", () => {
    // `$` compiles to `var(--name)` with no fallback, so the registration is the only thing standing
    // between a variable nothing sets and a property that silently becomes something else. A kind
    // that skipped registration would be a hole in that, with nothing to report it.
    const { css } = generate({
      a: kind("color", { one: "#fff" }),
      b: kind("any", { two: "whatever" }),
      c: kind("number", { three: 1 }),
    });

    expect(css.match(/@property/g)).toHaveLength(3);
  });

  test("no variables is no stylesheet, rather than an empty one", () => {
    expect(generate({}).css).toBe("");
  });
});

describe("the module", () => {
  test("`$` reaches a variable by the path it was declared at", () => {
    const { module: written } = generate(simple);

    expect(written).toContain('"main": "var(--color-primary-main)" as Token<"color", "#3b82f6">');
    expect(written).toMatch(/export const \$ = \{/);
  });

  test("it keeps the shape rather than flattening it", () => {
    const { module: written } = generate(simple);

    expect(written).toMatch(/"color":\s*\{\s*"primary":\s*\{/);
  });

  test("a number fallback stays a number, so `number` and `integer` are not stringified", () => {
    const { module: written } = generate({ weight: kind("number", { bold: 700 }) });

    expect(written).toContain('"var(--weight-bold)" as Token<"number", 700>');
  });
});

describe("naming what a property accepts", () => {
  test("the module exports `Value`, so a hole's value can be annotated", () => {
    const { module: written } = generate(simple);

    expect(written).toContain("export type Value<P extends keyof CssProperties> = CssProperties[P];");
    expect(written).toContain(
      'import type { BlockShapeOf, CssProperties as Base, Narrowed } from "@ramonda/css/properties";',
    );
    expect(written).toContain("export type CssProperties = Omit<Base, keyof Narrowings> & Narrowings;");
    expect(written).toContain("export type CssBlockShape = BlockShapeOf<CssProperties>;");
  });
});
