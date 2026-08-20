import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = () => analyzeProject(join(here, "fixtures", "fresh-hook-props", "tsconfig.json"));

/**
 * An object literal written into a HOOK's props — a context value above all.
 *
 * The sister of `fresh-object-in-props`, where a PARENT writes the literal in JSX. Measured in
 * core before this was written, counting a CONSUMER's renders while a different key of the same
 * provider moved three times: four renders with the literal, one with `@StableProps` on the
 * provider, and one when the callback reads nothing at all.
 */
describe("a hook prop rebuilt when the callback runs again", () => {
  test("every reactive read that can make the callback run again is followed", () => {
    const found = run().findings["fresh-object-in-hook-props"];

    expect(found.map((issue) => `${issue.hook}.${issue.prop}:${issue.kind} <- ${issue.rebuiltBecauseOf}`)).toEqual([
      "Plain.conf:object <- this.tick",
      "Plain.conf:object <- this.n",
      "Plain.conf:object <- this.props.id",
      "Plain.conf:object <- this.upstream",
      "BaseProvider.conf:array <- this.tick",
    ]);
  });

  /**
   * The silence this rule stands on, and the reason it is not just "a literal in a callback".
   *
   * The props callback is CACHED on the signals it read: one that reads none is called once, at
   * mount, and a literal inside it then keeps one identity for the life of the component. That is
   * not a fault, it is what `apps/playground-core` relies on for its query defaults — and a rule
   * reporting it would be reporting correct code at the one place the framework is at its best.
   */
  test("a callback that reads nothing reactive is silent", () => {
    const found = run().findings["fresh-object-in-hook-props"];
    expect(found.map((issue) => issue.rebuiltBecauseOf)).not.toContain("this.plain");
    // Five of the eleven `use` calls in the fixture are reported, so a leak shows as a count.
    expect(found).toHaveLength(5);
  });

  /**
   * A declared key, on a hook and on a Provider — which takes it on a SUBCLASS, because
   * `createContext` hands back a class rather than a declaration site.
   */
  test("a key the hook declared with @StableProps is not reported", () => {
    const hooks = run().findings["fresh-object-in-hook-props"].map((issue) => issue.hook);
    expect(hooks).not.toContain("Settled");
    expect(hooks).not.toContain("SettledProvider");
  });

  /**
   * The guard that keeps this shippable: a `.d.ts` carries no decorators, so `@StableProps` on an
   * installed hook cannot be seen from outside the package that wrote it — `@ramonda/query`
   * declares `key` and `invalidates` exactly that way. A rule that cannot tell a missing
   * declaration from an invisible one may not report either.
   */
  test("a hook reached through a declaration file is never reported", () => {
    const hooks = run().findings["fresh-object-in-hook-props"].map((issue) => issue.hook);
    expect(hooks).not.toContain("InstalledHook");
  });
});
