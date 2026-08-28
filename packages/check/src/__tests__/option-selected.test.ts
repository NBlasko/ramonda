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
  test("every spelling of it, whatever it says and wherever it sits", () => {
    // 13 bare, 21 `selected={true}`, 29 one level down in an optgroup, 52 `selected={false}`, 60 a
    // value per row. The question is whether the attribute is THERE, because `Select` overwrites it
    // either way — see the note below.
    expect(found().map((issue) => issue.line)).toEqual([13, 21, 29, 52, 60]);
  });

  /**
   * PRESENCE, not the value, and the first version of this rule got it wrong.
   *
   * It asked whether the attribute claimed TRUE, reasoning that `selected={false}` says the opposite
   * and is not overwritten into anything it was not already. That reasoning is about HTML, and this
   * is not about HTML: `Select` sets the choice from its `value` unconditionally.
   *
   * Worse, it missed the shape the fault is usually written in. `selected={o.id === value}` is
   * somebody controlling the choice from the OPTION side — precisely the belief this rule exists to
   * correct — and it was silent for it, because the value cannot be read. Found by walking the rule
   * against Part A of the checklist: a module const, a helper call, a ternary and a row field were
   * planted, and three of the four were silent.
   */
  test("a value it cannot read is still an attribute that is there", () => {
    expect(found().map((issue) => issue.line)).toContain(60);
    expect(found().map((issue) => issue.line)).toContain(52);
  });

  test("and the report names the option, so a reader can find the line", () => {
    // The four written out say `value="a"`; the one built per row has a value this cannot read, and
    // the report drops the name rather than inventing one.
    expect(found().map((issue) => issue.value)).toEqual(["a", "a", "a", "a", undefined]);
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
   * Three silences, and the first is the whole point of the component.
   *
   * 37 writes no `selected` at all and lets `value` decide. 44 is built from data and claims
   * nothing, which is what every real list looks like. 68 spreads, and the spread may be carrying
   * the attribute or replacing it — so the element is not asked about at all.
   */
  test("the correct shapes stay silent", () => {
    const lines = found().map((issue) => issue.line);
    for (const quiet of [37, 44, 68]) {
      expect(lines, `line ${quiet} should be silent`).not.toContain(quiet);
    }
  });
});
