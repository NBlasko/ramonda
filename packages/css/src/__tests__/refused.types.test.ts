import { describe, expect, expectTypeOf, test } from "vitest";
import { RESETS_DIFFER } from "../compiler/leaves.generated";
import type { CssProperties, CssShorthand } from "../properties.generated";

/**
 * A property this package cannot make work is not an option at all — not in the types, and so not
 * in an editor's completions. `-webkit-mask` renders differently in WebKit than in Chromium and
 * Firefox; `resets-differ-across-engines` refuses it, and this keeps it from being offered.
 */
describe("a refused shorthand is not a type", () => {
  test("it is refused, which is why it is left out", () => {
    expect(Object.keys(RESETS_DIFFER)).toContain("-webkit-mask");
  });

  test("the property map has no -webkit-mask, and neither does the shorthand union", () => {
    expectTypeOf<CssProperties>().not.toHaveProperty("-webkit-mask");
    expectTypeOf<"-webkit-mask">().not.toMatchTypeOf<CssShorthand>();
    // Its sibling, which works everywhere, is still there.
    expectTypeOf<CssProperties>().toHaveProperty("mask");
  });
});
