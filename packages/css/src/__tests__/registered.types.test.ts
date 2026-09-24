import { describe, test } from "vitest";
import type { CssVar } from "../token";
import { toStyle } from "../value";

/**
 * Setting a REGISTERED property at run time, checked against the `syntax` it declared.
 *
 * A `@@property` binding is the generated name, so it already works as a key in a plain object —
 * what it cannot do there is refuse a value of the wrong kind. `toStyle` already holds a DECLARED
 * variable to its range, by inferring the pair and checking it second; a registered property is the
 * same question about a different name, so it is the same function rather than a second one.
 *
 * Asserted with `@ts-expect-error`, which fails the build if a line ever stops being an error — so
 * the refusal cannot quietly go away.
 */
describe("a registered property's value is held to its syntax", () => {
  test("a value of the declared kind is taken", () => {
    declare0();
  });
});

function declare0(): void {
  // Real names, because this test RUNS as well as type-checks: `toStyle` reads the name it is given
  // and a stand-in object would throw before any assertion here got to mean anything.
  const angle = "--angle" as CssVar<"angle">;
  const pad = "--pad" as CssVar<"length">;
  const tone = "--tone" as CssVar<"color">;

  toStyle([[angle, "45deg"]]);
  toStyle([[pad, "8px"]]);
  toStyle([[tone, "#10b981"]]);
  toStyle([
    [angle, "45deg"],
    [pad, "8px"],
  ]);

  // @ts-expect-error — a length where an angle was declared
  toStyle([[angle, "45px"]]);
  // @ts-expect-error — an angle where a length was declared
  toStyle([[pad, "45deg"]]);
  // @ts-expect-error — a colour where a length was declared
  toStyle([[pad, "#10b981"]]);
  // @ts-expect-error — a name this package never wrote
  toStyle([["--mine", "45deg"]]);
}
