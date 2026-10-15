// @vitest-environment node
import { describe, expect, it } from "vitest";
import { listBody } from "../../scripts/list-body.mjs";

/**
 * The reader `check-api-coverage.mjs` takes a surface test's list with. Both ways it was written
 * dropped names with the build green: cut at the first `];`, a `];` in a comment ended the list early;
 * with comments stripped by pattern, a `/*` inside a `//` comment swallowed the rest of the list and
 * read names out of the code after it.
 */
const read = (source: string) =>
  [...listBody(source, source.indexOf("const LIST")).matchAll(/"([^"]*)"/g)].map((m) => m[1]);

describe("listBody", () => {
  it("reads to the list's own end", () => {
    expect(read(`const LIST = [\n  "A",\n  "B",\n];\ntest("x", () => {});`)).toEqual(["A", "B"]);
  });

  it("is not ended by a `];` in a comment", () => {
    expect(read(`const LIST = [\n  // as in \`kinds[0];\`\n  "A",\n  /* or [1]; */ "B",\n];`)).toEqual(["A", "B"]);
  });

  it("is not swallowed by a `/*` inside a line comment", () => {
    expect(
      read(`const LIST = [\n  // every src/*.ts file\n  "A",\n  "B",\n];\n/** doc */\ntest("x", () => {});`),
    ).toEqual(["A", "B"]);
  });

  it("does not take a `//` inside a string for a comment", () => {
    expect(read(`const LIST = [\n  "https://a",\n  "B",\n];`)).toEqual(["https://a", "B"]);
  });

  it("refuses a list that never ends", () => {
    expect(() => listBody(`const LIST = [\n  "A",`, 0)).toThrow(/never ends/);
  });
});
