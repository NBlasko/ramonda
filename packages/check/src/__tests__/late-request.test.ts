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
