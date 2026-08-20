import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = () => analyzeProject(join(here, "fixtures", "compute-arguments", "tsconfig.json"));

/**
 * A `@compute` that declares a parameter.
 *
 * Its cache is keyed by nothing, so an argument is accepted and ignored: the second call with a different
 * argument gets the first call's answer, with nothing thrown and nothing logged. The framework refuses it
 * when the class definition runs — but that is when the module is first imported, so a component behind a
 * route nobody opened ships with the fault. This reports it before the build.
 *
 * The type refuses it first — measured, `@compute withArg(k: number)` is `TS1241`, because a function that
 * declares a parameter is not assignable to one that declares none. So this rule is the second net, for a
 * project with no types or a `@ts-ignore`, exactly as `attribute-that-does-nothing` is beside the JSX
 * types.
 */
describe("a @compute that takes an argument", () => {
  test("every declaration is reported, with the parameter to delete", () => {
    const found = run().findings["compute-takes-no-arguments"];
    expect(found.map((issue) => `${issue.component}.${issue.member}(${issue.parameter}) x${issue.count}`)).toEqual([
      "OneParameter.times(n) x1",
      "TwoParameters.between(low) x2",
      "Base.scaled(by) x1",
    ]);
  });

  test("a base is reported once, not again for the subclass", () => {
    const found = run().findings["compute-takes-no-arguments"];
    expect(found.filter((issue) => issue.component === "Derived")).toEqual([]);
  });

  test("it fails the run", () => {
    const found = run().findings["compute-takes-no-arguments"];
    expect(found.length).toBeGreaterThan(0);
  });

  test.each([
    ["AGetter", "a getter cannot declare one"],
    ["AMethod", "a method with none is the other legitimate form"],
    ["Memoized", "`@memoized` is keyed BY arguments — the advice this rule gives"],
    ["Plain", "an undecorated method may take whatever it likes"],
  ])("%s is silent — %s", (component) => {
    const found = run().findings["compute-takes-no-arguments"];
    expect(found.filter((issue) => issue.component === component)).toEqual([]);
  });
});
