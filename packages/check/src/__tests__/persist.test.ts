import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = () => analyzeProject(join(here, "fixtures", "persist", "tsconfig.json"));

/**
 * `@persist` on a value the hydration blob cannot carry.
 *
 * The pairing is the test, and here it has two halves: the values JSON keeps, which must be silent,
 * and the same lossy values under `@state`, which must be silent for a different reason.
 */
describe("a persisted value JSON cannot carry", () => {
  test("every shape that is lost on the way is reported, and named for what it holds", () => {
    const found = run().findings["persist-of-a-lossy-value"];
    expect(found.map((issue) => `${issue.field}:${issue.holds}`)).toEqual([
      "byId:Map",
      "seen:Set",
      "openedAt:Date",
      "money:Formatter",
      "compare:a function",
      "meta:Date",
      "stamps:Date",
      "pending:Map",
    ]);
  });

  /**
   * The report says what JSON leaves behind rather than "not serializable", because the four fail
   * differently and the difference is what says whether a page is already broken.
   */
  test("the report says what the value becomes", () => {
    const found = run().findings["persist-of-a-lossy-value"];
    expect(found.find((issue) => issue.field === "openedAt")?.becomes).toContain("a string");
    expect(found.find((issue) => issue.field === "money")?.becomes).toContain("prototype");
  });

  /**
   * `@state` holding a `Date` is NOT this rule's business: reactive state only reaches the blob on a
   * server render, so a browser-only project may hold anything in it. The fixture writes exactly
   * that pair so the decorator, and not the value, is what decides.
   */
  test("the same value under `@state` is left alone", () => {
    const found = run().findings["persist-of-a-lossy-value"];
    expect(found.some((issue) => issue.field === "formatter" || issue.field === "stamp")).toBe(false);
  });

  test("a value JSON carries, and one this cannot read, are both silent", () => {
    const found = run().findings["persist-of-a-lossy-value"];
    const quiet = ["total", "label", "rows", "detail", "nothing", "loaded", "name"];
    expect(found.filter((issue) => quiet.includes(issue.field))).toEqual([]);
  });
});
