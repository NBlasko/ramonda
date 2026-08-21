import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = () => analyzeProject(join(here, "fixtures", "class-family", "tsconfig.json"));

/**
 * The class family, walked through `.claude/skills/writing-a-static-rule`.
 *
 * Three of the six read a value written where they look and go quiet one name away, and one of
 * those three was reporting an interval that really is cleared.
 */
describe("a class rule asked about the value one hop away", () => {
  /**
   * The runtime guard wraps a plain array or object whatever produced it, and this rule mirrors the
   * guard on purpose — so a name holding one is the same fault. Reading only the initializer meant
   * `@state rows = makeRows()` could be pushed to all day in silence.
   */
  test("`state-mutated-in-place` reads what the field holds through a name", () => {
    const fields = run().findings["state-mutated-in-place"].map((issue) => issue.field);

    expect(fields).toEqual(["written", "fromHelper", "shared", "branched", "bag"]);
  });

  /**
   * A FALSE REPORT before it was planted: `const id = setInterval(…); this.other = id` was read as
   * an id kept in a local that dies with the call — on a component whose `@destroyed` clears
   * `this.other`. A rule reporting correct code is the one thing this package may not do.
   */
  test("`interval-with-no-cleanup` follows the id out of the local it passes through", () => {
    expect(run().findings["interval-with-no-cleanup"]).toEqual([]);
  });

  /** A selector kept in a `const` is the same selector, and reads the same prop. */
  test("`watch-of-a-prop-that-is-not-there` reads a selector a name away", () => {
    const found = run().findings["watch-of-a-prop-that-is-not-there"];

    expect(found.map((issue) => issue.member)).toEqual(["onMissing", "onNamed"]);
    expect(found.map((issue) => issue.prop)).toEqual(["missing", "nope"]);
  });

  /** What already held, kept so a change to any of the three cannot take it away quietly. */
  test("the reads a render reaches are found wherever they are written", () => {
    const found = run().findings["clock-read-while-rendering"];

    // Written in the render, and behind a helper in another file. `new Date(iso)` parses and is
    // deterministic, so it is not one of them.
    expect(found.map((issue) => issue.through.join(" → "))).toEqual(["render", "render → stamp"]);
  });
});
