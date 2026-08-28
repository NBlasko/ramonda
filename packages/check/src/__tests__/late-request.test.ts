import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = () => analyzeProject(join(here, "fixtures", "late-request", "tsconfig.json"));

/**
 * `requestContext()` is live only while the render is running. On the server that is the
 * SYNCHRONOUS section — `renderToString` installs the scope, mounts, and clears it before its
 * first `await` — and the clearing is what makes one module-level value safe for a server handling
 * many requests at once. A read below a yield finds nothing.
 *
 * The framework reports it at runtime as RMD053. This says it first, and the two are not
 * redundant: a path nobody ran ships with the fault, and the throw beside RMD053 is swallowed by
 * the server's work drain, so the page is served complete and quietly missing the value.
 */
describe("requestContext() read below an await", () => {
  /**
   * Four spellings that were silent until they were planted: the framework's function reached
   * through an app's own re-export or through a namespace import, and a held context opened by a
   * destructure or a bracket rather than by a dot. All four read the same cleared scope.
   */
  test("every late shape is reported, with the whole read named", () => {
    expect(
      run().findings["late-request-read"].map((read) => `${read.component}.${read.member}: ${read.read} (${read.via})`),
    ).toEqual([
      "LateDirect.load: requestContext().get(currentUser) (call)",
      'LateThroughLocal.load: context.headers.get("accept-language") (local)',
      "LateAfterForAwait.load: requestContext().url.pathname (call)",
      'LateInField.load: requestContext().cookies.get("session") (call)',
      // The framework's own function, handed on by an app's `ui` module. Same function, same scope,
      // cleared at the same moment.
      'LateThroughAReExport.load: reExported().headers.get("accept-language") (call)',
      // The held door opened by a destructure and by a bracket rather than by a dot.
      "LateOtherSpellings.load: { headers } = context (local)",
      'LateOtherSpellings.load: context["cookies"] (local)',
      // A NAMESPACE import, which `core-import.ts` has always said arrives — and did not. It walked
      // one parent too far for a `NamespaceImport` and landed on the source file.
      'LateThroughANamespace.load: core.requestContext().headers.get("accept-language") (call)',
      "BothBelowReportsOnce.load: requestContext() (call)",
    ]);
  });

  /**
   * The half that decides whether the rule is worth having. A read ABOVE the first await is the
   * documented, correct shape — an async `@created` that reads the request and then goes fetching
   * — and a rule that flagged it would be a rule people switch off.
   */
  /**
   * One mistake, one report. When the context is TAKEN below the await, that line is the failure —
   * it throws, so the line reading through the local never runs. Following the local as well would
   * put a second report on dead code and point at the wrong line of the two.
   */
  test("taking and using below the await is reported once, on the take", () => {
    const reads = run().findings["late-request-read"].filter((read) => read.component === "BothBelowReportsOnce");
    expect(reads).toHaveLength(1);
    expect(reads[0].via).toBe("call");
  });

  test("a read above the await is not reported", () => {
    expect(run().findings["late-request-read"].some((read) => read.component === "EarlyThenFetches")).toBe(false);
  });

  test("a synchronous method cannot be late", () => {
    expect(run().findings["late-request-read"].some((read) => read.component === "Synchronous")).toBe(false);
  });

  test("a read inside the await's own operand is not late", () => {
    // `await requestContext().get(key)` evaluates the read and THEN suspends, so the request is
    // still installed. The walk has to descend into an await before raising its flag; doing it the
    // other way round reports this correct line.
    expect(run().findings["late-request-read"].some((read) => read.component === "ReadsInsideTheAwait")).toBe(false);
  });

  /**
   * A nested callback starts a clean timeline on purpose. Whether it runs before or after the
   * enclosing yield is dataflow, which this analyzer refuses by decision — and guessing would
   * report `items.map(…)` called synchronously, which is correct code.
   */
  test("a nested callback is its own timeline", () => {
    expect(run().findings["late-request-read"].some((read) => read.component === "NestedCallback")).toBe(false);
  });

  /**
   * Identity is the import specifier, not the name. An app is entitled to its own function called
   * `requestContext`, and reporting inside it would be reporting the reader's code for the
   * framework's rule — the trap the `document` rule accepts deliberately and this one must not,
   * because a same-named local here is plausible.
   */
  test("the app's own helper of the same name is left alone", () => {
    expect(run().findings["late-request-read"].some((read) => read.component === "OwnHelper")).toBe(false);
  });

  test("the report carries a position a reader can open", () => {
    const first = run().findings["late-request-read"][0];
    expect(first.file).toContain("late-request");
    expect(first.line).toBeGreaterThan(0);
    expect(first.column).toBeGreaterThan(0);
  });
});

/**
 * The shapes an `await` divides that the first fixture did not have.
 *
 * The rule documents its own boundary — "only a direct call or a same-scope local" — and defends it
 * as a division of labour with the runtime's RMD053. That reason is worth re-testing rather than
 * trusting, because the same docstring argues two paragraphs earlier that RMD053 is NOT a
 * sufficient backstop: it fires only on a path that RUNS, and the throw beside it goes into the
 * server's work drain and is swallowed.
 *
 * Measured: the blocks were all fine, and one hop was missing.
 */
describe("the shapes an await divides", () => {
  const shapes = () =>
    analyzeProject(join(here, "fixtures", "late-request-shapes", "tsconfig.json")).findings["late-request-read"];

  test("a `try`, a `finally` and a loop body are all below the await", () => {
    // 13, 30, 44. The block a read sits in changes nothing: the request is gone either way, and a
    // `finally` is exactly where a late read hides.
    expect(shapes().map((issue) => issue.component)).toContain("LateInATry");
    expect(shapes().map((issue) => issue.component)).toContain("LateInAFinally");
    expect(shapes().map((issue) => issue.component)).toContain("LateInALoop");
  });

  /**
   * `ctx = requestContext()` as a FIELD — the same take one scope out.
   *
   * The initializer runs at construction, inside the synchronous section the server has not yet
   * cleared, so the take is correct; every read of it below an `await` is late. Nothing reported
   * it, while the identical `const ctx = requestContext()` a line lower was. It is the shape
   * somebody writes precisely to stop calling `requestContext()` over and over, so the tidier the
   * code the less the rule saw.
   */
  test("and a context taken onto a field at construction is one too", () => {
    const field = shapes().find((issue) => issue.component === "LateThroughAField");
    expect(field).toBeDefined();
    expect(field?.via).toBe("field");
  });

  test("the whole list, so a regression cannot go quiet", () => {
    expect(shapes().map((issue) => issue.component)).toEqual([
      "LateInATry",
      "LateInAFinally",
      "LateInALoop",
      "LateThroughAField",
    ]);
  });

  /**
   * The three silences, each of which a worse rule would have punished.
   *
   * An `await` inside a NESTED function does not yield the body around it. A destructure taken
   * BEFORE the await has already run its getter, so the value is in hand. And a property read into
   * a local before the await is just a string afterwards.
   */
  test("an await inside a callback does not yield the body around it", () => {
    expect(shapes().map((issue) => issue.component)).not.toContain("AwaitsInsideACallback");
  });

  test("and a value taken before the await is in hand, however it was taken", () => {
    const guilty = shapes().map((issue) => issue.component);
    expect(guilty).not.toContain("TakenBeforeTheAwait");
    expect(guilty).not.toContain("PropertyHeldEarly");
  });
});
