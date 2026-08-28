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

/**
 * The two questions this rule asks, each asked properly.
 *
 * WHICH decorator, and WHETHER the awaits are caught. Both were answered by pattern-matching text,
 * and measured on a plant both were wrong — five real faults reported by nothing.
 */
describe("the shapes an unguarded await is written in", () => {
  const shapes = () =>
    analyzeProject(join(here, "fixtures", "async-lifecycle-shapes", "tsconfig.json")).findings[
      "unguarded-async-lifecycle"
    ];

  /**
   * Identity is the name CORE exports it under, not the one the file gave it.
   *
   * This repository's standing lesson, arriving late to one more rule: the decorator was compared
   * as a bare name, so `import { created as onCreate }` and `@core.created()` both went quiet on
   * the identical fault. The reader is now `lifecycle-env`'s own `coreDecorators`, so the two rules
   * cannot answer one question about one decorator two different ways — and the namespace form was
   * missing there too, which fixing it there fixed for both.
   */
  test("an aliased and a namespaced lifecycle are still lifecycles", () => {
    const guilty = shapes().map((issue) => issue.component);
    expect(guilty).toContain("Aliased");
    expect(guilty).toContain("ThroughANamespace");
  });

  test("and an app's OWN decorator of that name is not one", () => {
    expect(shapes().map((issue) => issue.component)).not.toContain("OwnDecorator");
  });

  /**
   * The guard question is about the AWAITS, not about the body.
   *
   * It used to be satisfied by any `try` anywhere in the method, or by any property called `catch`.
   * Three real faults hid behind that, and a fourth behind a `finally`:
   *
   * - a `try` around something else, with the fetch below it bare;
   * - `await a().catch(…)` followed by a second, unhandled `await`;
   * - `try { await … } finally { … }`, which runs on the way PAST a rejection without stopping it;
   * - an await in the `catch` clause, which its own `try` does not protect.
   */
  test("every await has to be handled, not just one of them", () => {
    const guilty = shapes().map((issue) => issue.component);
    expect(guilty).toContain("UnrelatedTry");
    expect(guilty).toContain("OnlyOneHandled");
    expect(guilty).toContain("TryWithOnlyFinally");
    expect(guilty).toContain("AwaitInTheCatch");
  });

  test("the whole list, so a regression cannot go quiet", () => {
    expect(shapes().map((issue) => issue.component)).toEqual([
      "Plain",
      "Aliased",
      "ThroughANamespace",
      "UnrelatedTry",
      "OnlyOneHandled",
      "TryWithOnlyFinally",
      "AwaitInTheCatch",
    ]);
  });

  test("and the two that really are handled stay silent", () => {
    const guilty = shapes().map((issue) => issue.component);
    expect(guilty).not.toContain("ProperlyGuarded");
    expect(guilty).not.toContain("HandledOnThePromise");
  });
});
