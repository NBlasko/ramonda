import { positionOf } from "../syntax";
import { descendantIn } from "./descendants";
import { openingOf } from "./element";
import type { ElementContext, ElementRule } from "./rule";

/**
 * A `<table>` of data with no `<th>` anywhere in it.
 *
 * A table is read visually by POSITION: the eye follows a column up to its heading and back down,
 * and that costs nothing. A screen reader cannot do that. It announces cells one at a time, and the
 * only thing that lets it say what a cell MEANS is the header association — "Price, £4.50" instead
 * of "£4.50", read out of a grid where the reader can see nothing.
 *
 * With no `<th>` at all there is no association to make, so every cell is announced bare. The
 * larger the table, the worse it gets, and past three or four columns the content is not merely
 * harder to read — it is unusable, because nothing says which column any value came from.
 *
 * It is also the most invisible fault in this package. `<td>` and `<th>` are one letter apart, they
 * are styled by the same CSS often enough that the table looks identical either way, and nothing at
 * runtime says a word.
 *
 * ## What it will not claim
 *
 * **Anything it cannot see.** A `<table>` whose rows come from `{rows.map(…)}`, or from a component,
 * may have headers written in there — and that is how most real tables are built, so this stays
 * quiet unless the table is written out and a `<th>` is genuinely absent. That is a large silence
 * and it is the honest one: a rule that guessed would report the commonest correct table there is.
 *
 * **A table with no rows at all.** An empty `<table>`, or one holding only a `<caption>`, is
 * scaffolding rather than data.
 *
 * **A LAYOUT table**, which says so: `role="presentation"` and `role="none"` are exactly how an
 * author declares that a table is not data, and the accessibility tree honours that. Reporting one
 * would be reporting the documented way of writing the thing this rule does not care about.
 */
export interface TableWithNoHeadersIssue {
  file: string;
  line: number;
  column: number;
}

export const tableWithNoHeaders = {
  id: "table-with-no-headers",

  report: {
    severity: "warn",
    reportedWhen: "a `<table>` written out with data rows has no `<th>` anywhere in it",
    heading: (found) => `${found.length} table(s) whose cells are announced with no heading:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      "    <table> has data rows and no `<th>` — a screen reader announces every cell with nothing to say what it is.",
    ],
    advice:
      "A table is read visually by POSITION: the eye follows a column up to its heading and back\n" +
      "down. A screen reader cannot do that — it announces cells one at a time, and the header\n" +
      'association is the only thing that lets it say "Price, £4.50" instead of "£4.50".\n\n' +
      "With no `<th>` there is no association to make. Past three or four columns the table is not\n" +
      "harder to read, it is unusable: nothing says which column any value came from.\n\n" +
      "Make the heading cells `<th>` and give each one a `scope`:\n\n" +
      "```tsx\n" +
      "<tr>\n" +
      '  <th scope="col">Item</th>\n' +
      '  <th scope="col">Price</th>\n' +
      "</tr>\n" +
      "```\n\n" +
      '`scope="row"` is for a heading down the left of each row, which is the other half of a table\n' +
      "that has both.\n\n" +
      'If the table is LAYOUT rather than data, say so with `role="presentation"` — that is what it\n' +
      "is for, and nothing here will ask again.\n\n" +
      "This is a warning today and an error in a later version.",
  },

  read(element, { tag, attr, children }: ElementContext) {
    if (tag !== "table") return [];

    // A layout table says so, and the accessibility tree honours it.
    const role = attr("role")?.trim().toLowerCase();
    if (role === "presentation" || role === "none") return [];

    /**
     * A `<th>` anywhere inside, or anything this cannot see through.
     *
     * `unreadable` and `found` are one answer here, and that is the whole shippability of the rule:
     * most real tables build their rows from data, and a component or an expression may well be
     * where the headers are.
     */
    if (descendantIn(children, (_opening, inside) => inside === "th") !== "none") return [];

    // No rows written out either: an empty table, or one holding only a `<caption>`, is scaffolding
    // rather than data, and there is nothing yet to announce badly.
    if (descendantIn(children, (_opening, inside) => inside === "td") !== "found") return [];

    return [positionOf(openingOf(element))];
  },
} as const satisfies ElementRule<TableWithNoHeadersIssue>;
