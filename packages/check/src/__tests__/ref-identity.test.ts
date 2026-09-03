import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = () => analyzeProject(join(here, "fixtures", "ref-identity", "tsconfig.json"));

/**
 * `createRef()` called where its answer cannot be kept.
 *
 * A ref is an identity: you keep it and read `current` later. `createRef()` answers a NEW object
 * every call, so one built in a render, a `@compute`, a `@memoized` member a render calls, or a
 * hook's props callback is a different ref every pass — the child re-renders for a `ref` that only
 * looks changed, and `current` is read off an object the next render already replaced.
 *
 * The runtime says the same thing as `RMD061`, but only once the line RUNS. A ref built in a branch
 * nobody has rendered stays quiet there and is reported here.
 */
describe("a ref built where the identity cannot be kept", () => {
  test("every place a render or a derivation reaches, with the path it took", () => {
    const found = run().findings["ref-built-where-it-cannot-be-kept"];

    expect(found.map((issue) => `${issue.component} via ${issue.through.join(" → ")}`)).toEqual([
      "InTheRender via render",
      "InTheAttribute via render",
      "ThroughAHelper via render → build",
      "InACompute via held",
      "InAMemoized via render → pick",
      "InAPropsCallback via Store's props",
    ]);
  });

  /**
   * The silences, each for its own reason, and all of them worth naming: a rule that reported any of
   * these would be reporting the fix.
   */
  test("a field, an app's own function, and a member no render calls are all quiet", () => {
    const found = run().findings["ref-built-where-it-cannot-be-kept"];
    const named = found.map((issue) => issue.component);

    // The place a ref belongs — plain and with a callback, which is what `Select` and `TextArea` do.
    expect(named).not.toContain("OnAField");
    expect(named).not.toContain("OnAFieldWithACallback");
    // Judged by where the binding came from, not by the name — and BOTH spellings, because the
    // aliased one alone proves nothing: a check that matched the identifier `createRef` stayed green
    // against it, since the alias renamed the call.
    expect(named).not.toContain("SomebodyElsesCreateRef");
    expect(named).not.toContain("OwnCreateRefUnderItsOwnName");
    // A phase that never runs cannot build a ref, which is the answer the runtime gives too.
    expect(named).not.toContain("MemoizedButUncalled");
  });

  /** The report points at the CALL, so a reader lands on the line that has to move. */
  test("the position is the createRef call", () => {
    const found = run().findings["ref-built-where-it-cannot-be-kept"];
    const inRender = found.find((issue) => issue.component === "InTheRender");

    expect(inRender?.file).toContain("app.tsx");
    expect(inRender?.line).toBeGreaterThan(0);
    expect(inRender?.column).toBeGreaterThan(0);
  });
});
