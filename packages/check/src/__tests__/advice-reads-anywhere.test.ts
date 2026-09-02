import { describe, expect, test } from "vitest";
import { ruleCatalogue } from "../rules";

/**
 * A rule's `advice` is read in TWO places, and it has to work in both.
 *
 * The command prints it under a report, where "the lines above" means something. The documentation
 * site builds a page per rule out of the same string — deliberately, so the terminal and the page
 * cannot drift — and there is nothing above it there.
 *
 * Found by reading a generated page: `row-without-a-key` said *"Each line above says which of the
 * two you are looking at"*, which on a page points at nothing. One rule of eighty-four, so the
 * corpus was already almost medium-independent; this is what keeps it that way, because the next
 * person writing advice will be looking at a terminal.
 */
describe("advice a reader meets in either place", () => {
  test("no rule points at the report around it", () => {
    /** Deliberately not `above` alone: advice legitimately says "the line above" about SOURCE. */
    const pointsAtTheReport =
      /(lines? above says|listed above|shown above|each line above|the list above|reported above)/i;

    const offenders = ruleCatalogue()
      .filter((rule) => pointsAtTheReport.test(rule.advice))
      .map((rule) => rule.id);

    expect(offenders).toEqual([]);
  });

  test("and the check can fail", () => {
    // The control. A pattern that stopped matching would leave the assertion above passing
    // against nothing, which is how this kind of test dies quietly.
    const pointsAtTheReport =
      /(lines? above says|listed above|shown above|each line above|the list above|reported above)/i;
    expect(pointsAtTheReport.test("Each line above says which of the two you are looking at.")).toBe(true);
  });

  test("every rule has advice at all", () => {
    const empty = ruleCatalogue().filter((rule) => rule.advice.trim() === "");
    expect(empty).toEqual([]);
  });
});
