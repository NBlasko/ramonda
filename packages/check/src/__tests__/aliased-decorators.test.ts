import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = () => analyzeProject(join(here, "fixtures", "aliased-decorators", "tsconfig.json"));

/**
 * A core decorator imported under another name.
 *
 * `hasDecorator` matched the name written on the member and asked nothing about where it came from
 * — the one identity question in this package that did not resolve. Fourteen call sites across nine
 * rules read through it, for `@state`, `@compute`, `@persist`, `@created`, `@destroyed` and
 * `@memoized`, so it failed in both directions at once:
 *
 * - `import { state as reactive }` made every class rule go quiet. Measured with the two components
 *   in the fixture, which are the same component written twice: the plain one produced two reports
 *   and the aliased one produced NOTHING, from any rule.
 * - an app's OWN decorator called `state` was judged as core's, which is the shape `own-list.ts`,
 *   `own-head.tsx` and `own-helper.tsx` exist to keep out of three other rules.
 *
 * It resolves now, through `Resolver.coreName` — which is hung on `resolve` itself rather than
 * threaded as a second parameter, because `resolve` already reaches all two dozen helpers that
 * needed it and a parameter a caller can forget is the shape that silenced every tree rule for a
 * commit.
 */
describe("a core decorator imported under another name", () => {
  test("is judged exactly as the plainly written one is", () => {
    const findings = run().findings;

    expect(findings["state-mutated-in-place"].map((issue) => issue.component)).toEqual([
      "Plain",
      "Aliased",
      "ThroughABarrel",
    ]);
    expect(findings["state-written-while-rendering"].map((issue) => issue.component)).toEqual([
      "Plain",
      "Aliased",
      "ThroughABarrel",
    ]);
  });

  /**
   * `export * from "@ramonda/core"` in an app's own `ui` module — and the one shape the specifier
   * chain cannot walk, because a star export resolves straight to core's own declaration, which
   * names no module at all. Measured: a barrel switched off every class rule at once, since
   * `hasDecorator` is the chokepoint they all read through.
   *
   * Answered by the PACKAGE the declaration lives in, which is why this fixture points at
   * `core-pkg` — a stub with a `package.json` that really says `@ramonda/core`.
   */
  test("a star re-export is core's too", () => {
    const found = run().findings["state-mutated-in-place"].map((issue) => issue.component);

    expect(found).toContain("ThroughABarrel");
  });

  /** The two are the same component written twice, so they earn the same findings. */
  test("the aliased component is judged on every rule the plain one is", () => {
    const everything = Object.entries(run().findings).flatMap(([id, issues]) =>
      (issues as { component?: string }[]).map((issue) => `${id}:${issue.component}`),
    );

    for (const found of everything.filter((one) => one.endsWith(":Plain"))) {
      expect(everything).toContain(found.replace(":Plain", ":Aliased"));
    }
    expect(everything.filter((one) => one.endsWith(":Aliased"))).toHaveLength(2);
    expect(everything.filter((one) => one.endsWith(":ThroughABarrel"))).toHaveLength(2);
  });
});
