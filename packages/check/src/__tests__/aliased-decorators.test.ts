import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = () => analyzeProject(join(here, "fixtures", "aliased-decorators", "tsconfig.json"));

/**
 * A core decorator imported under another name, and what it costs today.
 *
 * `hasDecorator` matches the name written on the member and asks nothing about where it came from —
 * unlike every other identity question in this package, which resolves. Fourteen call sites across
 * nine rules read through it, for `@state`, `@compute`, `@persist`, `@created`, `@destroyed` and
 * `@memoized`.
 *
 * So the two components in the fixture are the same component written twice, and only one of them
 * is judged. It fails in both directions:
 *
 * - `import { state as reactive }` makes every class rule go quiet — measured below, two reports
 *   become none.
 * - an app's OWN decorator called `state` would be judged as core's, which is the shape
 *   `own-list.ts`, `own-head.tsx` and `own-helper.tsx` exist to keep out of three other rules.
 *
 * `lifecycle-env.ts` had the same fault and it is fixed there, because that one is a LOOKUP rather
 * than a comparison and a wrong key made a false report at error severity — see
 * `env-reads.test.ts`. Fixing it here means threading resolution through those fourteen call sites
 * and the helpers under them, which is a decision rather than a repair.
 *
 * Kept as a test rather than a note, because a limit with no test is a limit somebody discovers.
 * When it is closed, this fails and the expectations move.
 */
describe("a core decorator imported under another name", () => {
  test("is judged when written plainly", () => {
    const findings = run().findings;

    expect(findings["state-mutated-in-place"].map((issue) => issue.component)).toEqual(["Plain"]);
    expect(findings["state-written-while-rendering"].map((issue) => issue.component)).toEqual(["Plain"]);
  });

  /** The same class, one import spelled differently, and nothing is said about it. */
  test("is judged by nothing when it is aliased — the known limit", () => {
    const everything = Object.values(run().findings).flat() as { component?: string }[];

    expect(everything.filter((issue) => issue.component === "Aliased")).toEqual([]);
  });
});
