import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = () => analyzeProject(join(here, "fixtures", "dead-attrs", "tsconfig.json"));

/**
 * An attribute that renders and does nothing.
 *
 * The types refuse all six at the call site with the right spelling written into the error, so this
 * rule is the second net — for a `@ts-ignore`, a cast, or a file with no types. A type is a defence
 * only while nobody casts it away.
 */
describe("an attribute that does nothing", () => {
  test("every dead name is reported, with what to write instead", () => {
    const found = run().findings["attribute-that-does-nothing"];
    expect(found.map((issue) => issue.attribute)).toEqual([
      "httpEquiv",
      "acceptCharset",
      "acceptcharset",
      "defaultValue",
      "defaultChecked",
      "innerHTML",
      "textContent",
    ]);
  });

  /** The fault does not depend on the capitals — a lowercase name goes through the index signature. */
  test("the lowercase spelling is as dead as the camelCase one", () => {
    const found = run().findings["attribute-that-does-nothing"];
    expect(found.filter((issue) => issue.attribute.toLowerCase() === "acceptcharset")).toHaveLength(2);
  });

  test("the correct spellings, and the two aliased names, are silent", () => {
    const found = run().findings["attribute-that-does-nothing"];
    const names = found.map((issue) => issue.attribute);
    for (const ok of ["http-equiv", "accept-charset", "value", "checked", "className", "htmlFor"]) {
      expect(names).not.toContain(ok);
    }
  });

  /** A component's props are its own; only a host element writes to the document. */
  test("a component is not asked", () => {
    const found = run().findings["attribute-that-does-nothing"];
    expect(found.every((issue) => issue.tag !== undefined && /^[a-z]/.test(issue.tag))).toBe(true);
  });
});
