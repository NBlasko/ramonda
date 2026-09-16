import { expectTypeOf } from "vitest";
import { describe, test } from "vitest";
import { type Variable, kind } from "../declared";

/**
 * The TYPE half of `kind( … )`, which is the half a runtime test cannot reach.
 *
 * Three claims, and each is the reason a part of the design exists:
 *
 *   1. the kind declared on a group reaches every leaf under it, and a nested group keeps its own;
 *   2. a leaf's own VALUE survives, which is what lets a narrowed property refuse one by naming the
 *      value rather than the variable;
 *   3. the fallback is narrowed AS IT IS TYPED, so the defaults are written against a real type.
 *
 * The third is asserted with `@ts-expect-error`, which fails the build if the line ever STOPS being
 * an error — so the narrowing cannot quietly go away.
 */
describe("what kind() produces, as a type", () => {
  test("the kind reaches every leaf, and a nested group keeps its own", () => {
    const variables = kind("length", {
      control: { md: "30px" },
      weight: kind("number", { bold: 700 }),
    });

    expectTypeOf(variables.control.md).toEqualTypeOf<Variable<"length", "30px">>();
    expectTypeOf(variables.weight.bold).toEqualTypeOf<Variable<"number", 700>>();
  });

  test("a colour keeps its literal, which is what a narrowed slot reads", () => {
    const variables = kind("color", { primary: { main: "#3b82f6" } });

    expectTypeOf(variables.primary.main).toEqualTypeOf<Variable<"color", "#3b82f6">>();
  });

  test("the fallback is narrowed by the kind", () => {
    // @ts-expect-error — a length where a colour was declared
    kind("color", { primary: { main: "30px" } });

    // @ts-expect-error — a colour where a length was declared
    kind("length", { control: { md: "#3b82f6" } });

    // @ts-expect-error — a unit this is not; `30ms` is a time
    kind("length", { control: { md: "30ms" } });

    // and the ones that are right stay right
    kind("color", { primary: { main: "currentcolor" } });
    kind("color", { primary: { main: "ButtonText".toLowerCase() as "buttontext" } });
    kind("length", { control: { md: "clamp(1rem, 2vw, 3rem)" } });
    kind("time", { fast: "120ms" });
  });
});
