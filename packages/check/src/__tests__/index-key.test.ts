import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = () => analyzeProject(join(here, "fixtures", "index-key", "tsconfig.json"));

/**
 * A key built from the row's POSITION, which is the identity the diff already had.
 *
 * The fixture writes ten lists and five of them are the fault, so a leak shows up as a count rather
 * than as a line number nobody reads.
 */
describe("a row keyed by its index", () => {
  test("every spelling of the index is reported", () => {
    const found = run().findings["index-as-key"];
    expect(found).toHaveLength(5);
    expect(found.every((issue) => issue.tag === "li" && issue.index === "i")).toBe(true);
    // The key AS WRITTEN, because a report that printed the index name would send somebody looking
    // for `key={i}` on a line that says `` key={`row-${i}`} ``.
    expect(found.map((issue) => issue.written)).toEqual(["i", "String(i)", "`row-${i}`", "i + 1", "i"]);
  });

  /**
   * The precision that makes it shippable: a key carrying the index BESIDE an identity is a real
   * identity, and reporting it would report the fix this rule's advice asks for.
   */
  test("a key that also carries an identity is left alone", () => {
    const found = run().findings["index-as-key"];
    // Ten lists in the fixture; the five that are not reported include `${row.id}-${i}`.
    expect(found).toHaveLength(5);
  });

  /** `list()` takes one argument, so the fault cannot be written there. Asserted, not assumed. */
  test("a `list()` row is not reported", () => {
    const found = run().findings["index-as-key"];
    expect(found.some((issue) => issue.index !== "i")).toBe(false);
  });
});
