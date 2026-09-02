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
  test("both faults are found, and each says which one it is", () => {
    const found = run().paramsOffRoute;

    expect(
      found.map((issue) =>
        issue.why === "no-outlet"
          ? `${issue.component}: no outlet`
          : `${issue.component}: on ${issue.route}, wanted ${issue.missing?.join(", ")}`,
      ),
    ).toEqual([
      "NavBar: no outlet",
      "Badge: no outlet",
      "WrongRouteChild: on /users/:id, wanted slug",
      "ConstPattern: on /users/:id, wanted slug",
      "AliasedRead: on /users/:id, wanted slug",
    ]);
  });

  /**
   * A pattern held in a `const`, on BOTH sides — the read and the table's key.
   *
   * Extracting routes into constants is the tidier way to write this, and reading only literals
   * went silent on exactly that: the tidier the code, the less was checked. One hop, `const` only,
   * because a `let` may hold something else by the time it is used.
   */
  test("a pattern and a table key sharing a constant are both read", () => {
    const found = run().paramsOffRoute.find((issue) => issue.component === "ConstPattern");
    expect(found?.route).toBe("/users/:id");
    expect(found?.missing).toEqual(["slug"]);
  });

  /** `const n = this.nav` is the other spelling, and it is followed the same one hop. */
  test("a read through a local alias is found", () => {
    const components = run().paramsOffRoute.map((issue) => issue.component);
    expect(components).toContain("AliasedRead");
  });

  /**
   * A KNOWN LIMIT, pinned so the day it changes is a day somebody chose.
   *
   * The navigator arrives as a prop, so there is no `this.use(Navigator)` on the class to recognise
   * it by — the receiver is `this.props.nav`, whose type this walk does not ask for.
   */
  /**
   * The run has to SURVIVE a ring of aliases, which is a guard rather than a report.
   *
   * `const a = b; const b = a;` followed the ring until the stack gave out — measured before the
   * bound, the command died with `RangeError` instead of reporting anything at all. Asserted as a
   * successful run rather than as a finding, because the finding is that there is no finding.
   */
  test("two consts naming each other do not take the run down", () => {
    const components = run().paramsOffRoute.map((issue) => issue.component);
    expect(components).not.toContain("ARingOfAliases");
    // The rest of the file is still judged, so the guard did not go quiet on everything.
    expect(components).toContain("WrongRouteChild");
  });

  test("a navigator passed as a prop is not seen", () => {
    const components = run().paramsOffRoute.map((issue) => issue.component);
    expect(components).not.toContain("NavAsProp");
  });

  /**
   * The case the pattern-keeping exists for, and the one the coarse check could never see.
   *
   * `WrongRouteChild` is a CHILD of a routed page. Something routes to it, so "is anything mounting
   * this?" answers yes — while the route above supplies no `:slug` and the router throws the moment
   * the page opens. The table's KEY is the only place a route's params are written down, and until
   * it was carried through the walk this was unreachable statically.
   */
  test("a child reading another route's param is reported with the route it is really on", () => {
    const wrong = run().paramsOffRoute.find((issue) => issue.component === "WrongRouteChild");

    expect(wrong?.why).toBe("wrong-route");
    expect(wrong?.route).toBe("/users/:id");
    expect(wrong?.missing).toEqual(["slug"]);
  });

  /**
   * Two routes that AGREE about a param, which the router documents as correct: a component
   * rendered by both `/users/:id` and `/people/:id` names one of them and is right on both, because
   * what it asked for is satisfied on both. The claim is about the params, not the spelling.
   */
  test("a component under two routes that both supply the param is silent", () => {
    const components = run().paramsOffRoute.map((issue) => issue.component);
    expect(components).not.toContain("Shared");
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

  /**
   * One arrangement with no outlet above is enough, even where others have one.
   *
   * `Badge` is rendered inside a routed page AND beside the outlet. This test used to assert the
   * opposite, and that was the bug: reporting only components that are NEVER routed made the two
   * faults disagree — a component under two routes that disagree about a param was reported, while
   * this one was not, although both throw on an arrangement the source produces.
   */
  test("an arrangement with no outlet above is reported even where another has one", () => {
    const badge = run().paramsOffRoute.find((issue) => issue.component === "Badge");
    expect(badge?.why).toBe("no-outlet");
  });

  test("a read written outside render is still found", () => {
    // `GuidePage` reads in a getter, and it IS routed — so this asserts the collection reaches
    // members other than `render`, by way of the component that would be reported if it did not.
    const components = run().paramsOffRoute.map((issue) => issue.component);
    expect(components).not.toContain("GuidePage");
    expect(components).not.toContain("UserPage");
  });
});
