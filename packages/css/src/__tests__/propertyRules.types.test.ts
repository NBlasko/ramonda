import { describe, test } from "vitest";
import { defineConfig } from "../configEntry";

/**
 * The CONFIG's own type, which is what guides somebody writing one.
 *
 * `DESIGN.md` names three faults it has to catch, and each is asserted with `@ts-expect-error` —
 * which fails the build if the line ever stops being an error, so a loosened type cannot go quiet.
 *
 * One trap while reading these: **TypeScript reports one excess-property error per object literal**,
 * so a literal with several faults looks like it missed the first. Each case is therefore its own
 * literal.
 */
describe("what the config type refuses", () => {
  test("a property CSS does not have", () => {
    // @ts-expect-error — `z-indx`
    defineConfig({ properties: { "z-indx": { values: [1] } } });
  });

  test("`shorthand` on a property that is not one", () => {
    // @ts-expect-error — `color` is a longhand, so the key cannot exist
    defineConfig({ properties: { color: { shorthand: false } } });
  });

  test("an arity CSS does not give that property", () => {
    // @ts-expect-error — CSS gives `padding` at most four
    defineConfig({ properties: { padding: { arity: 7 } } });

    // @ts-expect-error — and `padding-block` at most two
    defineConfig({ properties: { "padding-block": { arity: 3 } } });
  });

  test("`arity` on a property that takes one value anyway", () => {
    // @ts-expect-error — `color` is one colour; there is no count to pick
    defineConfig({ properties: { color: { arity: 2 } } });
  });

  test("a unit that is not one", () => {
    // @ts-expect-error — `pxx`
    defineConfig({ properties: { "*": { units: ["pxx"] } } });
  });

  test("a key the rule does not have", () => {
    // @ts-expect-error — `arity` is the spelling
    defineConfig({ properties: { padding: { arrity: 2 } } });
  });
});

describe("what it accepts", () => {
  test("the shapes DESIGN.md gives as the ones people write", () => {
    defineConfig({
      properties: {
        "*": { shorthand: false, arity: 1 },
        margin: { shorthand: true, arity: 4 },
        "z-index": { values: [1, 2, 5, 10] },
        "letter-spacing": { units: ["em", "rem"] },
      },
    });
  });

  test("a wildcard on its own, which is the one-line sweep", () => {
    defineConfig({ properties: { "*": { units: ["px"] } } });
  });
});
