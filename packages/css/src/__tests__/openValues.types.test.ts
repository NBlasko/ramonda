import { describe, expect, test } from "vitest";
import { ENGINE_OPEN } from "../compiler/keywords.engine.generated";
import type { CssProperties } from "../properties.generated";
import { rules } from "./rules/helpers";

/**
 * A union is only right for a property whose value IS one of its words.
 *
 * `mdn-data` closed `column-rule-style` over the ten line styles, and Chromium takes a list of them —
 * `solid, dashed`, `repeat(2, solid)` — for the gap decorations it ships. The map had typed it
 * `CssValue` until mdn-data 2.37 gave it a plain grammar, and the new union refused CSS a browser
 * renders. So the engines are asked whether a property takes more than one word, and one that does
 * is not a union. The assertions are the assignments, which `tsc` checks.
 */
describe("a value an engine takes is not refused by the type", () => {
  test("a list of rule styles, which Chromium takes", () => {
    const list: CssProperties["column-rule-style"] = "solid, dashed";
    const repeated: CssProperties["column-rule-style"] = "repeat(2, solid)";
    expect([list, repeated]).toHaveLength(2);
  });

  test("and the value rules take them too, while a misspelt word is still reported", () => {
    expect(rules("  column-rule-style: solid, dashed;")).toEqual([]);
    expect(rules("  column-rule-style: repeat(2, solid);")).toEqual([]);
    expect(rules("  column-rule-style: soild;")).toContain("unknown-value");
  });

  test("and it is the engines that said so", () => {
    expect(ENGINE_OPEN).toContain("column-rule-style");
  });
});
