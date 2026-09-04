import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = () => analyzeProject(join(here, "fixtures", "params-claims-a-key", "tsconfig.json"));
const reported = () => run().keysOffRoute;
const names = () => reported().map((issue) => issue.component);

/**
 * A key named at an argument-less `params()` that the route does not supply.
 *
 * The other door, and until now nothing looked through it. `params(pattern)` is checked twice — the
 * router throws in `assertPattern` and `ParamsOffRouteIssue` says it before anything renders — while
 * `params()` was checked nowhere, and the router's own message sends people to it: *"drop the
 * argument and use `params<T>()` if it is rendered by routes that do not agree on their params"*.
 *
 * **Why judging it is not a contradiction of that advice.** The pattern argument was never an
 * assertion about which route you are on. Measured: `ParamPath<C>` is any table path carrying a
 * `:param`, and `assertPattern` compares only the NAMES against what matched — so a component under
 * `/users/:id/edit` and `/admin/users/:id` may name either pattern and is correct on both. The
 * argument names keys. So both doors are asking the same question and only one of them was answered.
 *
 * **And this failure is the quieter of the two.** `Router.tsx` calls `assertPattern` only
 * `if (pattern !== undefined)`. Nothing throws here: the read hands back a params object without the
 * key, and a type that promised `string` delivers `undefined`.
 *
 * The line between a claim and a question is what the author wrote AT the call. A required member, a
 * plain destructuring, a property taken off the call — those are claims. `?`, a default, a read off a
 * variable one line later — those are not, and the last of them is the escape the router's message
 * points at, kept open on purpose.
 */
describe("a params() read that claims a key", () => {
  test("all three spellings of a claim are reported, and each says which it was", () => {
    const how = new Map(reported().map((issue) => [issue.component, issue.how]));

    expect(how.get("WrongType")).toBe("type");
    expect(how.get("WrongDestructured")).toBe("destructured");
    expect(how.get("WrongProperty")).toBe("property");
  });

  test("the report names the route above the read and the key it does not supply", () => {
    const issue = reported().find((each) => each.component === "WrongType");

    expect(issue).toMatchObject({
      why: "wrong-route",
      route: "/teams/:teamId",
      keys: ["userId"],
      missing: ["userId"],
    });
  });

  test("a claim the route supplies is silent", () => {
    expect(names()).not.toContain("RightClaim");
  });

  test("`?` and a default are questions rather than claims", () => {
    // The type argument DECIDES, which is a repair rather than a nicety: falling through to the
    // property spelling reported `params<{ userId?: string }>().userId` and overrode the `?`.
    expect(names()).not.toContain("OptionalType");
    expect(names()).not.toContain("DefaultedDestructure");
  });

  test("a read taken off a variable is not judged, which is the escape that stays open", () => {
    expect(names()).not.toContain("ThroughAVariable");
  });

  test("a type argument that is a NAME says nothing here, and that limit is deliberate", () => {
    expect(names()).not.toContain("NamedType");
  });

  test("naming no key claims nothing", () => {
    expect(names()).not.toContain("NamesNothing");
  });

  test("asking WHETHER a key is there is not claiming that it is", () => {
    // `params().hasOwnProperty("teamId")` was reported as a claim on a key called `hasOwnProperty`,
    // which turns the careful read into the fault. Found reviewing this branch.
    expect(names()).not.toContain("AsksIfPresent");
  });

  test("beside the outlet, every claimed key is absent and the read still does not throw", () => {
    const issue = reported().find((each) => each.component === "Beside");

    expect(issue).toMatchObject({ why: "no-outlet", keys: ["teamId"] });
    expect(issue?.route).toBeUndefined();
  });

  test("a claim inside a hook is judged against the route above its USER", () => {
    const issue = reported().find((each) => each.component === "TeamHook");

    expect(issue).toMatchObject({ why: "wrong-route", route: "/teams/:teamId", missing: ["userId"] });
    expect(issue?.path).toEqual(["App", "RouteOutlet", "TeamPage", "TeamHook"]);
  });

  test("two routes, one without the key: reported, which is the answer to any-or-every", () => {
    // The pattern door reports when ANY reaching route fails, and so does this. A component under
    // `/players/:id` and `/teams/:teamId` claiming `id` reads `undefined` on the second, and that
    // arrangement is one the source really produces. The escape is to say the key MAY be absent.
    const issue = reported().find((each) => each.component === "SharedClaim");

    expect(issue).toMatchObject({ why: "wrong-route", route: "/teams/:teamId", missing: ["id"] });
  });

  test("two routes that both supply it: silent", () => {
    expect(names()).not.toContain("AgreedClaim");
  });

  test("optional chaining guards the object, not the key", () => {
    // `params()?.userId` says the params object may be absent. It says nothing about `userId` being
    // absent FROM it, so the claim stands — measured rather than assumed.
    const issue = reported().find((each) => each.component === "OptionalChain");

    expect(issue).toMatchObject({ how: "property", why: "wrong-route", missing: ["userId"] });
  });

  test("under a nested outlet, the inner route is the one that answers", () => {
    // The walk REPLACES the route above rather than adding to it, mirroring the runtime: each outlet
    // publishes only what it matched. So a page under `/members/:memberId` claiming the outer
    // `teamId` is reading a key nothing publishes there.
    const issue = reported().find((each) => each.component === "MemberPage");

    expect(issue).toMatchObject({ why: "wrong-route", route: "/members/:memberId", missing: ["teamId"] });
  });

  test("the pattern door is unchanged by any of this", () => {
    expect(run().paramsOffRoute).toEqual([]);
  });
});
