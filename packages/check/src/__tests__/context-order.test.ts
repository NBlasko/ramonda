import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const found = () =>
  analyzeProject(join(here, "fixtures", "context-order", "tsconfig.json")).findings[
    "context-consumed-above-its-provider"
  ];

/**
 * A consumer declared ABOVE the provider that publishes on the same component.
 *
 * A component publishes a context on its own object, and a consumer resolves its channel once, when
 * it is constructed — in field-declaration order. So the consumer above looked before the provider
 * below it existed, and reads an ancestor's value instead. Swapping two field declarations changes
 * what the page shows, which is the kind of edit nobody reads as a change.
 *
 * The OTHER order is deliberately silent, and that is a measurement rather than a preference:
 * `this.use(QueryClientProvider)` followed by `this.use(Query, …)` is mount-a-client-then-query-on-it,
 * and reporting it fired 14 times across `@ramonda/query`'s own tests. See RMD057 in core, which
 * catches the same arrangement at runtime and reaches the wrapped case this cannot.
 */
describe("a context consumed above its provider", () => {
  test("every consumer-first pair is reported, and named by its context", () => {
    expect(found().map((issue) => `${issue.component}: ${issue.context}`)).toEqual([
      "ConsumerFirst: Theme",
      "WithAFieldBetween: Size",
      "RenamedBindings: Theme",
      "ProvidesUnderIt: Theme",
      "ConsumerFirstOnTheBase: Theme",
    ]);
  });

  /**
   * Once per fault, not once per class that inherits it. Walking the chain made a pair written on a
   * shared base visible from every subclass; one half has to be declared HERE for this to speak.
   */
  test("a pair written on a base is reported once, by the base", () => {
    expect(found().filter((each) => each.component === "InheritsTheOrder")).toEqual([]);
    expect(found().filter((each) => each.component === "ConsumerFirstOnTheBase")).toHaveLength(1);
  });

  /**
   * A BASE CLASS is part of the order, and it used to be missed entirely: the rule read one class
   * body, so a consumer inherited from a base and a provider mounted here were never compared.
   *
   * Field initialisers run base-first on ONE instance, which makes the inherited consumer always the
   * earlier of the two. Measured against core: this pair reports `RMD057` at runtime, and the rule
   * that claims to say it first said nothing.
   */
  test("a consumer inherited from a base is above a provider mounted here", () => {
    const issue = found().find((each) => each.component === "ProvidesUnderIt");
    expect(issue?.consumer).toBe("ThemeConsumer");
    expect(issue?.provider).toBe("ThemeProvider");
    // Named, because the two halves are in two class bodies and a line number alone would not say.
    expect(issue?.providerOn).toBeUndefined();
  });

  /** The other order across the chain is the arrangement the packages are built around. */
  test("a base that provides and a subclass that consumes is silent", () => {
    expect(found().some((each) => each.component === "ProvidesThenConsumes")).toBe(false);
  });

  /**
   * The report points at the CONSUMER — the line that reads the unexpected value — and names the
   * provider's line, so both halves of the fault can be found from one report.
   */
  test("it points at the consumer's field and names the provider's line", () => {
    const issue = found().find((each) => each.component === "ConsumerFirst");
    const source = join(here, "fixtures", "context-order", "app.tsx");
    expect(issue?.file).toBe(source);
    expect(issue?.line).toBe(31);
    expect(issue?.providerAtLine).toBe(32);
    expect(issue?.consumer).toBe("ThemeConsumer");
    expect(issue?.provider).toBe("ThemeProvider");
  });

  /**
   * The pair is identified by the `createContext` DECLARATION, so an import alias is transparent and
   * two contexts of the same shape are two contexts.
   */
  test("an import alias is followed, and the binding's local name is what the report says", () => {
    const issue = found().find((each) => each.component === "RenamedBindings");
    expect(issue?.consumer).toBe("Reads");
    expect(issue?.provider).toBe("Publishes");
  });

  test("the correct arrangements stay silent", () => {
    const reported = new Set(found().map((issue) => issue.component));
    for (const quiet of [
      // Provider first — mount, then use. What the packages do.
      "ProviderFirst",
      "OnlyAConsumer",
      "OnlyAProvider",
      // Consuming one context above providing a DIFFERENT one is not one context.
      "TwoDifferentContexts",
      // Reached by index off a held pair: nothing proves which half is which, so nothing is said.
      "ReachedByIndex",
      "App",
    ]) {
      expect(reported.has(quiet), `${quiet} should not be reported`).toBe(false);
    }
  });
});
