import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = () => analyzeProject(join(here, "fixtures", "params-through-a-hook", "tsconfig.json"));

/**
 * A hook is an extension of the component that uses it, and the params rule is where that first had
 * to be true.
 *
 * **The fault this fixes, and it failed a build on CORRECT code.** `this.use(X)` is a `uses` edge and
 * never a mount, so the walk that follows mounts left every hook out of `reached`, `routesAbove` and
 * `pathTo`. `deadOnes` then closed the SHARED `reached` over `uses` for its own question — a hook no
 * component uses is not dead — and `readsOffTheRoute`, which runs after it, read that widened set as
 * if the walk had produced it. A hook was therefore "reached" with no arrival recorded, which its
 * only test for that state reads as `no-outlet`. Measured: a hook reading `params("/teams/:teamId")`
 * used by a component mounted at exactly `/teams/:teamId` was reported. Every rule is an error, so
 * that is a red build for code the router runs happily.
 *
 * **It took both halves, which the plants show.** Carrying no arrivals to a hook while still closing
 * `reached` over `uses` fails five of the six tests below, the false alarm among them — that is the
 * old fault exactly. Dropping the closure altogether fails only three: with no hook in `reached` the
 * reads are skipped rather than misjudged, so the reports go missing instead of going wrong.
 */
describe("params read through a hook", () => {
  test("a hook reading the param its user's route supplies is silent", () => {
    const found = run().paramsOffRoute;

    expect(found.map((issue) => issue.component)).not.toContain("TeamData");
  });

  test("no read here is `no-outlet`, because every one of these hooks has a routed user", () => {
    // The shape of the old fault rather than one instance of it: a hook with a user under a route
    // can never be "no outlet above", whatever it asked for.
    expect(run().paramsOffRoute.filter((issue) => issue.why === "no-outlet")).toEqual([]);
  });

  test("the fault is named with the route above the USER, and the path says how it got there", () => {
    const issue = run().paramsOffRoute.find((each) => each.component === "WrongInHook");

    expect(issue).toMatchObject({ why: "wrong-route", route: "/teams/:teamId", missing: ["slug"] });
    expect(issue?.path).toEqual(["App", "RouteOutlet", "TeamPage", "WrongInHook"]);
  });

  test("two hops down, the arrival that condemns it is found even though it comes second", () => {
    // `InnerRead` is reached only through `OuterWrap`, and `/alpha/:x` — the route that fails it —
    // is closed after `/beta/:b`, which satisfies it. One pass keeps whichever arrived first and
    // goes silent; see `closeOverHooks` on why the closure is a fixpoint.
    const issue = run().paramsOffRoute.find((each) => each.component === "InnerRead");

    expect(issue).toMatchObject({ why: "wrong-route", route: "/alpha/:x", missing: ["b"] });
  });

  test("a hook two components disagree about is reported once, on an arrangement that fails", () => {
    const issues = run().paramsOffRoute.filter((each) => each.component === "SharedData");

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ why: "wrong-route", missing: ["id"] });
  });

  test("a hook nothing uses is the dead-declaration finding, not this one", () => {
    const result = run();

    expect(result.paramsOffRoute.map((issue) => issue.component)).not.toContain("OrphanData");
    expect(result.unreachable.map((issue) => issue.name)).toContain("OrphanData");
  });
});
