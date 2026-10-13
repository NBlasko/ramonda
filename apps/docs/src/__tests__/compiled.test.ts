import { describe, expect, test } from "vitest";
import { compiledExample } from "../../scripts/compiled-example.mjs";

/**
 * A `compiled` fence shows what the build makes of a block, and it is made by the build's own
 * compiler — so a page cannot say a block becomes CSS it does not become.
 */
describe("a compiled example", () => {
  test("is the classes an element gets and the CSS the build emits for them", () => {
    const { classes, css } = compiledExample(`const card = @@( display: flex; gap: 8px; );\n`, "test");

    expect(classes).toBe("r-disp-flex\nr-gap-\nr-row_gap-8px\nr-column_gap-8px");
    expect(css).toContain(".r-disp-flex { display:flex; }");
    expect(css).toContain(".r-row_gap-8px { row-gap:8px; }");
  });

  test.each([
    ["a block the build refuses", `const card = @@( colr: red; );\n`, /does not compile/],
    ["no block at all", `const card = "x";\n`, /holds no style block/],
  ])("%s fails the build, naming the page", (_what, source, said) => {
    expect(() => compiledExample(source, "style-blocks/x.md")).toThrow(said);
    expect(() => compiledExample(source, "style-blocks/x.md")).toThrow(/style-blocks\/x\.md/);
  });
});
