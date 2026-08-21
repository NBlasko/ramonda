import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = (name: string) => analyzeProject(join(here, "fixtures", name, "tsconfig.json"));

/**
 * A dynamic import the bundler cannot split, because it cannot read the path.
 *
 * The first rule of the per-FILE family: a question about what a module imports has no class to
 * hang off, so it reads a source file rather than a class declaration.
 *
 * It is also the first rule whose shape was decided by a measurement rather than by the rule it was
 * ported from. Across this repository: 88 dynamic imports with a literal path and 3 without — and
 * all three carry `/* @vite-ignore *\/`, the bundler's own marker. A version that reported them
 * would have opened by crying wolf at three deliberate decisions, which is the failure this package
 * exists not to have.
 */
describe("a dynamic import whose path is not a literal", () => {
  test("is reported, and a literal path is not", () => {
    const found = run("dynamic-import").findings["unsplittable-import"];
    // FOUR sites write `import(name)`: one plain, one `@vite-ignore`, one annotated with a reason,
    // one with an EMPTY directive. The last is reported — an empty directive buys nothing, which is
    // what keeps the note from being the price of switching a rule off.
    expect(found.map((s) => s.path)).toEqual(["name", "`./pages/${name}`", "`pages/${name}.js`", "name"]);
  });

  /**
   * A template the bundler CAN read, which this used to report.
   *
   * Measured with Vite 7 rather than reasoned about: `` import(`./pages/${w}.js`) `` transformed 4
   * modules and emitted `a-*.mjs` and `b-*.mjs`. Take the suffix off, or the leading `./`, and it is
   * 1 module and no chunk — so both halves are required, and the two spellings without them are the
   * rows above.
   *
   * Reporting the splittable one was reporting a documented feature working exactly as documented,
   * which is this package's own definition of a rule earning its way out of a project.
   */
  test("a template with a relative head and a suffix splits, and is not reported", () => {
    const found = run("dynamic-import").findings["unsplittable-import"];
    expect(found.map((s) => s.path)).not.toContain("`./pages/${name}.js`");
  });

  /**
   * The bundler warned and the author answered, so there is nothing left to tell them. This is the
   * exemption that keeps the rule usable — without it, every deliberate computed import in a real
   * project is a report nobody can act on.
   */
  test("the bundler's own marker silences it", () => {
    const found = run("dynamic-import").findings["unsplittable-import"];
    // The `@vite-ignore` one and the one with a written reason are silenced; the plain one and the
    // one whose directive says nothing are not. Counting is what says so — a line number would pass
    // while the wrong two were silenced.
    expect(found.filter((s) => s.path === "name")).toHaveLength(2);
  });

  /**
   * This package's own annotation, which does more than silence: the reason travels into
   * `annotated`, so it is printed on every run and cannot quietly stop being true.
   */
  test("`ramonda-check-ignore` silences it and keeps the reason", () => {
    const { annotated } = run("dynamic-import");
    expect(annotated.map((a) => a.reason)).toContain("the panel's specifier is built so the build cannot follow it");
    expect(annotated.map((a) => a.what)).toContain("unsplittable-import");
  });

  /**
   * An empty directive is refused here exactly as it is everywhere else in this package: a
   * `ramonda-check-ignore` with nothing after it is a silence, not a record.
   */
  test("an empty directive is itself reported", () => {
    const { unresolved } = run("dynamic-import");
    expect(unresolved.map((u) => u.why)).toContain(
      "a `ramonda-check-ignore` with no reason after it is a silence, not a record",
    );
  });
});
