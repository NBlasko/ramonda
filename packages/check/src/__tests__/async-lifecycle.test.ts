import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = () => analyzeProject(join(here, "fixtures", "async-lifecycle", "tsconfig.json"));
const found = () => run().findings["unguarded-async-lifecycle"];

/**
 * An error boundary does not see a rejection from an `async` lifecycle, and that is deliberate — it
 * arrives at an arbitrary later moment, when the page is already interactive and there is no render
 * left to fail. What follows is the fault: the page renders as though the method succeeded, the
 * `@state` it meant to fill is still at its initial value, and the only trace is an unhandled
 * rejection in a console nobody is watching.
 *
 * `RMD059` says so once the path has run. This says it before it ships, including for the failure
 * nobody has provoked yet — which is the half a runtime diagnostic can never cover.
 */
describe("an async lifecycle whose failure nothing would report", () => {
  test("an unguarded await in a lifecycle is reported", () => {
    expect(found().map((issue) => `${issue.component}.${issue.member} @${issue.phase}`)).toEqual([
      "Unguarded.load @mounted",
    ]);
  });

  test("a try around the await is the whole point, and silences it", () => {
    expect(found().some((issue) => issue.component === "Guarded")).toBe(false);
  });

  /**
   * A method marked `async` that never suspends can only throw SYNCHRONOUSLY, and the lifecycle
   * runner catches that and hands it to the boundary. Reporting it would be reporting something
   * that already works.
   */
  test("an async lifecycle that never awaits is not reported", () => {
    expect(found().some((issue) => issue.component === "NoAwait")).toBe(false);
  });

  test("an ordinary async method is not a lifecycle", () => {
    expect(found().some((issue) => issue.component === "PlainAsync")).toBe(false);
  });

  test("the report carries a position a reader can open", () => {
    const first = found()[0];
    expect(first.file).toContain("async-lifecycle");
    expect(first.line).toBeGreaterThan(0);
  });
});
