import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = (name: string) => analyzeProject(join(here, "fixtures", name, "tsconfig.json"));

/**
 * Asking the browser where you are, in a project whose router already knows.
 *
 * The two are the same fact from two sources and only one is reactive: read from the router a
 * component re-renders when the route moves, read from `window` it is a snapshot taken once. The
 * failure is quiet — the page is simply out of date — which is why it is worth a rule rather than a
 * matter of taste.
 */
describe("a component reading the browser's URL", () => {
  test("is reported, with the router's answer where there is one", () => {
    const { browserUrlReads } = run("browser-url");
    expect(browserUrlReads.map((r) => `${r.read} -> ${r.instead ?? "—"}`)).toEqual([
      "window.location.pathname -> pathname",
      "location.hash -> hashTags",
      "window.location.search -> searchParams",
      // Nothing on the router answers `origin`, and none is invented for it.
      "window.location.origin -> —",
    ]);
    expect(new Set(browserUrlReads.map((r) => r.component))).toEqual(new Set(["Astray"]));
  });

  /**
   * A local of the same name is not the global, and the difference costs no type: the program is
   * built with `noLib` and no `@types`, so the browser's own `location` resolves to nothing while
   * one written in the source resolves where it is written.
   */
  test("a local called `location` is left alone", () => {
    const { browserUrlReads } = run("browser-url");
    expect(browserUrlReads.some((r) => r.component === "Careful")).toBe(false);
  });

  /**
   * A read, and only a read. `window.location.href = "…"` is a different fault with a different
   * answer, and `location.reload()` is the one thing the router genuinely cannot replace —
   * reported as "reads", both would be advice to do something impossible.
   */
  test("a write and a method call are not reads", () => {
    const { browserUrlReads } = run("browser-url");
    expect(browserUrlReads.some((r) => r.component === "Leaving")).toBe(false);
  });

  /**
   * Without a router there is nowhere else to read it from, and a rule that reports the only thing
   * a reader could have written is a rule people switch off.
   */
  test("a project with no router is not reported at all", () => {
    // The same read as above, in a project that imports no router. Asserted against a fixture that
    // HAS the read: pointed at one without it, this test passes whatever the rule does.
    expect(run("browser-url-no-router").browserUrlReads).toEqual([]);
  });

  /**
   * It is a WARNING for now, which is this repository's rule for a new rule: one version that says
   * so, the next that refuses. Nothing must fail a build on it yet.
   */
  test("it does not fail the run", () => {
    const result = run("browser-url");
    expect(result.browserUrlReads.length).toBeGreaterThan(0);
    expect(result.issues).toEqual([]);
    expect(result.unresolved).toEqual([]);
  });
});
