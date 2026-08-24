import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const lines = () =>
  (
    analyzeProject(join(here, "fixtures", "lonely-label", "tsconfig.json")).findings["label-that-names-nothing"] ?? []
  ).map((issue) => issue.line);

/**
 * A `<label>` with nothing to be a label FOR.
 *
 * A label is an association, not styled text, and HTML gives it two ways to make one: `htmlFor`
 * naming a control's id, or a control written inside it. With neither, the element renders, looks
 * completely right, and does nothing.
 *
 * Two things are lost. The control it was meant for has no accessible name — which is
 * `control-with-no-label`'s report at the other end of the same missing pair — and clicking the text
 * no longer focuses the field, which is the affordance everybody uses without thinking about it and
 * the one that makes a form usable for somebody with a tremor.
 */
describe("a label with nothing to label", () => {
  test("a label with neither half of the association", () => {
    // 21 is bare text; 24 has markup inside it that is not a control, which reads even more like a
    // finished thing.
    expect(lines()).toEqual([21, 24]);
  });

  /**
   * Nine silences, and most of them are the reason this rule can ship at all.
   *
   * 29 and 34 write an `htmlFor` — the second one unreadable, which is still written, and whether
   * it points at a real id is `reference-to-an-id-that-is-not-there`'s question rather than a
   * second report on one line. 37 and 42 wrap the control, at one level and at two. 49 wraps a
   * COMPONENT, which is the ordinary way a form is written and whose markup is decided inside it.
   * 54 puts it in an expression. 57 spreads, and the spread may carry the `htmlFor`. 60 and 63 are
   * a `<select>` and a `<textarea>`, which are controls as much as an `<input>` is.
   */
  test("every association this can see, or cannot rule out, stays silent", () => {
    for (const quiet of [29, 34, 37, 42, 49, 54, 57, 60, 63]) {
      expect(lines(), `line ${quiet} should be silent`).not.toContain(quiet);
    }
  });
});
