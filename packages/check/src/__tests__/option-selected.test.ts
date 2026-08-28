import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const found = () =>
  analyzeProject(join(here, "fixtures", "option-selected", "tsconfig.json")).findings["option-that-cannot-choose"] ??
  [];

/**
 * `<option selected>` inside a `<Select>`, which overwrites it on every render.
 *
 * `Select` decides the choice from its `value`, and it does so by walking EVERY option and setting
 * each one — on and off, for all of them. So an option that asked to be chosen is turned off again
 * a moment later. The attribute is not competing with `value` and losing sometimes; it does nothing
 * at all, while being the one line on the page that looks like it chooses.
 *
 * This is the fault the refused `<select>` tag could not reach. The tag is refused because HTML
 * keeps the LAST of competing `selected` claims and gives an unclaimed select its first option, so
 * the same markup meant different things depending on the order the options arrived in — not an
 * order anybody writes. `<Select value={x}>` settles that; the option's own attribute stayed
 * writable.
 */
describe("an option that cannot choose", () => {
  test("every spelling of the claim, including one nested in an optgroup", () => {
    // 13 bare, 21 `selected={true}`, 29 one level down — which is how a grouped select is written.
    expect(found().map((issue) => issue.line)).toEqual([13, 21, 29]);
  });

  test("and the report names the option, so a reader can find the line", () => {
    expect(found().every((issue) => issue.value === "a")).toBe(true);
  });

  /**
   * This one has a single answer, so the checker carries it rather than describing it.
   *
   * Deleting the attribute leaves the page doing exactly what it already did — `Select` decides
   * from `value` either way — and the span starts at the whitespace BEFORE it, so removing it does
   * not leave a double space behind.
   */
  test("every report carries the edit that removes it", () => {
    expect(found().every((issue) => issue.edit?.text === "")).toBe(true);
    expect(found().every((issue) => issue.edit?.says === "remove `selected`")).toBe(true);
  });

  /**
   * Four silences, and the first is the whole point of the component.
   *
   * 37 writes no `selected` at all and lets `value` decide. 44 is built from data this cannot read.
   * 50 says `selected={false}`, which is the opposite claim and is not overwritten into anything it
   * was not already. 57 spreads, and the spread may be carrying the attribute or replacing it.
   */
  test("the correct shapes stay silent", () => {
    const lines = found().map((issue) => issue.line);
    for (const quiet of [37, 44, 50, 57]) {
      expect(lines, `line ${quiet} should be silent`).not.toContain(quiet);
    }
  });
});
