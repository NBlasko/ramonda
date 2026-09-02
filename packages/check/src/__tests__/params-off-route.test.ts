import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = () => analyzeProject(join(here, "fixtures", "params-off-route", "tsconfig.json"));

/**
 * `params("/users/:id")` read where no route matched.
 *
 * The router throws on this in every build — `assertPattern`, and the message names the pattern and
 * the route that is actually on. This is the same fault said before anything renders, on every
 * arrangement the source can produce, which is what the whole graph exists for.
 *
 * **Why nothing else could catch it.** The params context is declared `optional`, deliberately: `{}`
 * is a real answer for a nav bar or a footer BESIDE the outlet, and `Navigator` holds that consumer
 * for everyone — so reporting the missing provider would accuse the arrangement the router
 * documents. The fault is which METHOD is called, not which context is consumed, and no rule about
 * contexts can see that.
 *
 * The types cannot either: `params<Pat extends ParamPath<C>>` constrains the pattern to one the
 * TABLE declares, never to the route this component is standing on.
 */
describe("params read off the route", () => {
  test("a read beside the outlet is reported, and a read under it is not", () => {
    const found = run().paramsOffRoute;

    expect(found.map((issue) => `${issue.component}.${issue.member}(${issue.pattern})`)).toEqual([
      "NavBar.nav(/users/:id)",
    ]);
  });

  /**
   * The silences, each for its own reason. Together they are why this can fail a build.
   */
  test("pathname beside the outlet is not a fault", () => {
    const components = run().paramsOffRoute.map((issue) => issue.component);
    expect(components).not.toContain("Footer");
  });

  test("the untyped door claims no route, so it is not judged", () => {
    const components = run().paramsOffRoute.map((issue) => issue.component);
    expect(components).not.toContain("Breadcrumbs");
  });

  test("a component right on ANY path it is mounted on is not reported", () => {
    // `Badge` is rendered beside the outlet AND inside a routed page. One arrangement answers the
    // read, and the walk has to remember that rather than judging each arrival on its own.
    const components = run().paramsOffRoute.map((issue) => issue.component);
    expect(components).not.toContain("Badge");
  });

  test("a read written outside render is still found", () => {
    // `GuidePage` reads in a getter, and it IS routed — so this asserts the collection reaches
    // members other than `render`, by way of the component that would be reported if it did not.
    const components = run().paramsOffRoute.map((issue) => issue.component);
    expect(components).not.toContain("GuidePage");
    expect(components).not.toContain("UserPage");
  });
});
