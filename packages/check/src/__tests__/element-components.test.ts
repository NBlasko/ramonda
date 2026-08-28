import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = () => analyzeProject(join(here, "fixtures", "element-components", "tsconfig.json")).findings;
const lines = (id: string) => (run()[id] ?? []).map((issue) => issue.line);

/**
 * A COMPONENT that IS an element, and the rules that key on a tag.
 *
 * `<select>` and `<textarea>` are refused by core's own types, because neither can be written
 * correctly as a tag: a select's choice is decided by the order its options reached it, and a
 * textarea's value is its CHILD rather than an attribute. `Select` and `TextArea` settle both — and
 * left the checker meeting a component where the tag used to be.
 *
 * Measured before this: `<Select aria-hidden="true" httpEquiv="refresh">` with no label was reported
 * by ONE rule, while the identical faults on an `<input>` beside it were reported by four. Every
 * rule keyed on a tag went quiet for the two elements an author now has no other way to write.
 */
describe("a component that is an element", () => {
  test("the tag rules read `<Select>` and `<TextArea>` as the elements they are", () => {
    // 21 is `<Select>`, 25 `<TextArea>`, 27 core's `Select` under an ALIAS.
    expect(lines("aria-hidden-on-focusable")).toEqual([21, 25, 27]);
    expect(lines("control-with-no-label")).toEqual([21, 25, 27]);
  });

  /**
   * `control-with-no-label` needed a second fix, and it is the standing lesson again.
   *
   * The element family reads its tag through `contextFor`; the id table walks the JSX itself and
   * asked `tagOf` directly, so it decided `<Select>` was not a CONTROL at all. One question, two
   * readers, and only one of them had been taught.
   */
  test("including the one that decides what a form control is, which walks its own way", () => {
    expect(lines("control-with-no-label")).toContain(21);
  });

  /**
   * Identity is the name core EXPORTS, not the name on the line.
   *
   * 27 is core's `Select` imported as `Chooser` and is reported; 38 is an application's own
   * component that happens to be called `TextArea2` and is nobody's business. That is
   * `resolve.coreName`'s answer, the same one `duplicate-decorators` reads, so a second answer to it
   * cannot appear here.
   */
  test("an alias is still core's, and an application's own component is not", () => {
    expect(lines("aria-hidden-on-focusable")).toContain(27);
    expect(lines("aria-hidden-on-focusable")).not.toContain(38);
    expect(lines("control-with-no-label")).not.toContain(38);
  });

  /** A named one is nobody's report, which is the silence the rules already keep for a tag. */
  test("and a named one stays silent", () => {
    for (const quiet of [32, 35]) {
      expect(lines("control-with-no-label"), `line ${quiet} is named`).not.toContain(quiet);
    }
  });
});
