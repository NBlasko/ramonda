import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { PROPERTIES } from "../compiler/keywords.generated";
import { INERT_SUBJECTS } from "../compiler/rules";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const PAGE = join(ROOT, "apps", "docs", "content", "style-blocks", "does-nothing.md");

/** Measured to work on a block container, so naming them would report correct CSS. */
const ACT_ON_A_BLOCK = ["align-content", "justify-items", "place-items", "place-content"];

/**
 * The page that lists what `declaration-does-nothing` reports, against the rule itself.
 *
 * **These two drifted apart within an hour of both being written.** The page was written from the
 * first version of the table; a review then narrowed the rule — `-webkit-box` arranges children
 * after all, `aspect-ratio` only counts plain lengths, an `overflow` longhand rescues `resize` and
 * the ellipsis — and the page went on describing the version before it.
 *
 * Nothing catches a page that is merely wrong: the examples in it compile, the gate is green, and a
 * reader believes it. So the one thing that can be compared mechanically is compared here.
 */
describe("the page for a declaration that does nothing", () => {
  const page = readFileSync(PAGE, "utf8");
  /** The section that lists them — the table and the paragraphs that expand its rows. */
  const table = page.slice(page.indexOf("## What is reported"), page.indexOf("## What stays silent"));

  test.each(INERT_SUBJECTS)("names `%s`", (property) => {
    // A row may name one with its value — `text-overflow: ellipsis` — which still names it.
    expect(new RegExp(`\`${property}(\`|:)`).test(table)).toBe(true);
  });

  /**
   * And the other way: no CSS PROPERTY on the page that the rule cannot report.
   *
   * Measured against the generated property list rather than by the shape of the word, because the
   * section is full of backticked values — `flex`, `fixed`, `min-content` — and a test that could
   * not tell a value from a property reported all of them.
   */
  test("names no property the rule does not report", () => {
    const named = [...table.matchAll(/`([a-z-]+)(?:`|:)/g)].map((one) => one[1]);
    /** What a row names as the DECIDER or the RESCUER rather than as the subject. */
    const beside = new Set([
      "display",
      "position",
      "overflow",
      "overflow-x",
      "overflow-y",
      "white-space",
      "width",
      "height",
      "columns",
      "column-count",
      "column-width",
    ]);
    /**
     * `flex` and `grid` are shorthand PROPERTIES and also `display` values, and it is the values the
     * page writes. Nothing in the text can tell the two apart, so they are named here instead.
     */
    const values = new Set(["flex", "grid"]);
    const extra = named.filter(
      (one) =>
        PROPERTIES.includes(one) &&
        !INERT_SUBJECTS.includes(one) &&
        !beside.has(one) &&
        !values.has(one) &&
        !ACT_ON_A_BLOCK.includes(one),
    );

    expect(extra).toEqual([]);
  });

  /**
   * The four the page names in order to say they are NOT faults.
   *
   * Measured in Chromium: `align-content`, `justify-items`, `place-items` and `place-content` all
   * work on a block container, and the first version of the rule reported every one of them. The
   * paragraph naming them is what stops a reader filing the report back as a bug — and it has to
   * stay true, so the rule is asked as well.
   */
  test.each(ACT_ON_A_BLOCK)("says `%s` is not one, and the rule agrees", (property) => {
    expect(table).toContain(`\`${property}\``);
    expect(INERT_SUBJECTS).not.toContain(property);
  });
});
