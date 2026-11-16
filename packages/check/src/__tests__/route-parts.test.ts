import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = () => analyzeProject(join(here, "fixtures", "route-parts", "tsconfig.json"));

/**
 * A route table put together from parts — `createRoutes(tournamentRoutes, cond ? debugRoutes : undefined,
 * { "/": <Home /> })` — read through every part, as `DESIGN-module-routes.md` step 3 asks.
 *
 * Measured before it was built: the checker read only a literal table, so on this shape it missed both
 * planted `params()` faults in the modules' pages and reported both modules' tables as handed to no
 * outlet — a false error on correct code, and silence on two real ones.
 */
describe("a route table from parts", () => {
  test("a page reached through a part is judged on the route its part names", () => {
    expect(
      run().paramsOffRoute.map((issue) => `${issue.component}: on ${issue.route}, wanted ${issue.missing?.join(", ")}`),
    ).toEqual(["TournamentPage: on /tournaments/:id, wanted wrong", "DebugPage: on /debug, wanted nope"]);
  });

  test("a part another table takes is not stranded; a part nothing takes still is", () => {
    expect(run().unreachableRoutes.map((issue) => issue.file.split("/").slice(-2).join("/"))).toEqual([
      "orphan/routes.tsx",
    ]);
  });
});
