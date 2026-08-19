import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = (name: string) => analyzeProject(join(here, "fixtures", name, "tsconfig.json"));

/**
 * `unserializable-state` — `RMD019` and `RMD033`, asked only where there is a blob to cross.
 *
 * The two fixtures are the SAME components. The only difference is one import, and that is the
 * whole rule: a `Map` in state is wrong when the server has to hand it to the client, and perfectly
 * correct when nothing ever does.
 *
 * The gate is a second `needs` rather than a check inside the rule, so a browser-only project does
 * not SKIP the rule — the rule is not part of that run at all, which is the honest shape and the
 * one the router rule already established.
 */
describe("a state value the hydration blob cannot carry", () => {
  test("is reported where something renders on a server", () => {
    const found = run("ssr-state").findings["unserializable-state"];
    expect(found.map((issue) => `${issue.field}:${issue.holds}`)).toEqual(["byId:Maps", "meta:Dates"]);
  });

  /** The same components, one import fewer, and nothing to say about any of them. */
  test("is not asked at all in a browser-only project", () => {
    expect(run("spa-state").findings["unserializable-state"]).toEqual([]);
  });

  /**
   * `@persist` says the field is meant to travel whatever the project does about servers, so the
   * ungated rule answers it — and two reports on one line is how a reader learns to skim past both.
   */
  test("a field that is also `@persist` is left to the rule with no gate", () => {
    const findings = run("ssr-state").findings;
    expect(findings["unserializable-state"].some((issue) => issue.field === "both")).toBe(false);
    expect(findings["persist-of-a-lossy-value"].some((issue) => issue.field === "both")).toBe(true);
  });
});
