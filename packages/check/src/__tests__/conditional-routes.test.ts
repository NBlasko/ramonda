import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = () => analyzeProject(join(here, "fixtures", "conditional-routes", "tsconfig.json"));

/**
 * A route that exists only under a condition — `import.meta.env.DEV ? debugRoutes : undefined`, or the
 * app's own `features.admin ? adminRoutes : undefined` — linked to from code that is not under it.
 *
 * The type cannot see this: the compiler reads one program, where the condition is a `boolean`, so the
 * route is in the type in every build. Without the condition the link lands on the catch-all, and the
 * development diagnostics never meet it when the condition is the development build's. See the router's
 * `DESIGN-module-routes.md`, section 3: a part under a condition holds routes a link must reach under
 * the same condition — the same name or expression — or from inside that part's own pages.
 */
describe("a link to a route that exists only under a condition", () => {
  test("is reported where it is not under that condition, with the condition it needs", () => {
    expect(
      run().linksToConditionalRoutes.map(
        (issue) => `${issue.component}:${issue.line} ${issue.href} needs ${issue.condition}`,
      ),
    ).toEqual([
      "NavBar:24 /admin needs features.admin",
      "NavBar:32 /debug needs import.meta.env.DEV",
      "NavBar:36 /debug/cache needs import.meta.env.DEV",
      "NavBar:38 /admin/${…} needs features.admin",
      "NavBar:40 /admin/:id needs features.admin",
      "WithQuery:68 /debug?tab=cache needs import.meta.env.DEV",
      "WithQuery:69 /debug#top needs import.meta.env.DEV",
    ]);
  });
});

/**
 * Review round 2: a part under a condition, inside a part under another. The route exists only where
 * BOTH hold, and the outer condition used to overwrite the inner one, so a link under the outer alone
 * was silent.
 */
describe("a route behind two conditions", () => {
  test("needs both, and a link under one of them is reported — an early return counts as a condition", () => {
    const found = analyzeProject(
      join(here, "fixtures", "conditional-routes-nested", "tsconfig.json"),
    ).linksToConditionalRoutes;
    expect(found.map((issue) => `${issue.component}:${issue.line} ${issue.href} needs ${issue.condition}`)).toEqual([
      "Nav:21 /debug/admin needs features.admin && import.meta.env.DEV",
      "EarlyOutBackwards:43 /debug needs import.meta.env.DEV",
    ]);
  });
});
