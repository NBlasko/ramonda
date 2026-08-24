import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const lines = () =>
  (
    analyzeProject(join(here, "fixtures", "table-headers", "tsconfig.json")).findings["table-with-no-headers"] ?? []
  ).map((issue) => issue.line);

/**
 * A `<table>` of data with no `<th>` anywhere in it.
 *
 * A table is read visually by POSITION — the eye follows a column up to its heading and back down,
 * and that costs nothing. A screen reader cannot do that: it announces cells one at a time, and the
 * header association is the only thing that lets it say "Price, £4.50" instead of "£4.50", read out
 * of a grid the reader can see nothing of.
 *
 * It is also the most invisible fault in this package. `<td>` and `<th>` are one letter apart, they
 * are styled by the same CSS often enough that the table looks identical either way, and nothing at
 * runtime says a word.
 */
describe("a table whose cells have no heading", () => {
  test("a table written out with data rows and no `<th>`", () => {
    // 18 is the flat form; 30 goes through `<thead>`/`<tbody>`, which changes nothing about the
    // association — a `<td>` inside a `<thead>` is still a data cell.
    expect(lines()).toEqual([18, 30]);
  });

  /**
   * Eight silences, and the third of them is the whole shippability of the rule.
   *
   * 44 and 56 write their headers out, by column and by row. 64 builds its rows from data and 73
   * holds a COMPONENT — that is how most real tables are made, and the headers may well be in
   * there, so `unreadable` and `found` are one answer here on purpose. A rule that guessed would
   * report the commonest correct table there is.
   *
   * 81 and 89 are LAYOUT tables and say so; `role="presentation"` is exactly how an author declares
   * that a table is not data, and reporting one would be reporting the documented way of writing
   * the thing this rule does not care about. 96 has no rows and 99 only a caption — scaffolding
   * rather than data, with nothing yet to announce badly.
   */
  test("everything this cannot see, and everything that is not data, stays silent", () => {
    for (const quiet of [44, 56, 64, 73, 81, 89, 96, 99]) {
      expect(lines(), `line ${quiet} should be silent`).not.toContain(quiet);
    }
  });
});
