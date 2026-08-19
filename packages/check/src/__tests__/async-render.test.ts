import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";
import { failingRules } from "../rules";

const here = dirname(fileURLToPath(import.meta.url));
const run = () => analyzeProject(join(here, "fixtures", "async-render", "tsconfig.json"));

/**
 * A render that returns a promise.
 *
 * This rule exists although `tsc` refuses both spellings, and that is the interesting part: a
 * `@ts-ignore` or a base class loosened by one cast compiles, and what ships then throws
 * `TypeError: component is not a constructor` from inside the diff, naming neither the component
 * nor `render`. A type is a defence only while nobody casts it away.
 */
describe("an async render()", () => {
  test("both spellings are reported, and named apart", () => {
    const found = run().findings["async-render"];
    expect(found.map((issue) => `${issue.component}:${issue.written}`)).toEqual(["Feed:method", "Sidebar:field"]);
  });

  test("an async method that is not the render is left alone", () => {
    const found = run().findings["async-render"];
    expect(found.some((issue) => issue.component === "Panel")).toBe(false);
  });

  /**
   * It is an `error` rather than a warning, which is a departure from "a new rule is a warning
   * first" and is deliberate: no `async render()` is correct, so nothing correct can be reported,
   * and the alternative to failing the build is a `TypeError` in somebody's browser.
   */
  test("it fails the run", () => {
    expect(failingRules(run().findings).map((rule) => rule.id)).toContain("async-render");
  });
});
