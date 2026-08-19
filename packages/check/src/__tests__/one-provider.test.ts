import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const found = () =>
  analyzeProject(join(here, "fixtures", "context-order", "tsconfig.json")).findings["one-provider-per-component"];

/**
 * Two Providers of one context on one component — which core REFUSES at runtime (RMD056).
 *
 * A component publishes a context on one object, so the second replaces the first and every
 * descendant reads the second whichever part of the tree it is in. The runtime throw arrives when the
 * component is CONSTRUCTED, so a component down a branch nobody has opened ships with it and takes
 * the page out on the click that finally reaches it. This says it from the source instead.
 *
 * An ERROR rather than the usual warning-first, and deliberately: a warning would say "survivable"
 * about a line that crashes.
 */
describe("one Provider of a context per component", () => {
  test("every second Provider is reported, named by its context", () => {
    expect(found().map((issue) => `${issue.component}: ${issue.context}`)).toEqual([
      "ProvidesTwice: Theme",
      "ProvidesTwiceRenamed: Theme",
    ]);
  });

  /** It points at the SECOND one — the line that throws and the one to move — and names the first. */
  test("it points at the second and names the first's line", () => {
    const issue = found().find((each) => each.component === "ProvidesTwice");
    expect(issue?.file).toBe(join(here, "fixtures", "context-order", "app.tsx"));
    expect(issue?.line).toBe(96);
    expect(issue?.firstAtLine).toBe(95);
    expect(issue?.provider).toBe("ThemeProvider");
  });

  /**
   * `ProvidesTwiceRenamed` holds `SizeProvider`, then `Publishes` and `ThemeProvider` — which are the
   * SAME binding under two names. One report, for the Theme pair, and nothing for Size.
   */
  test("an alias is followed, so two names for one context are one context", () => {
    const issue = found().find((each) => each.component === "ProvidesTwiceRenamed");
    expect(issue?.provider).toBe("ThemeProvider");
    expect(issue?.firstAtLine).toBe(105);
  });

  test("the correct arrangements stay silent", () => {
    const reported = new Set(found().map((issue) => issue.component));
    for (const quiet of [
      // Two CONSUMERS publish nothing.
      "ConsumesTwice",
      // One of each is RMD057's question, not this one.
      "ConsumerFirst",
      "ProviderFirst",
      // One Provider, and a nested one on another component — the ordinary arrangement.
      "OnlyAProvider",
      "TwoDifferentContexts",
      // Reached by index off a held pair: nothing proves which half is which.
      "ReachedByIndex",
      "App",
    ]) {
      expect(reported.has(quiet), `${quiet} should not be reported`).toBe(false);
    }
  });
});
