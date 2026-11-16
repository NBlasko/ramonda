import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = () => analyzeProject(join(here, "fixtures", "root-through-helper", "tsconfig.json"));

/**
 * A root whose argument is a call to a helper — `bootstrap(shell())`, `bootstrap(wrap(ui))`.
 *
 * A helper is a node of the graph, and a component that calls one gets a `calls` edge to it: nothing
 * is followed, the helper's tags are read where they are written. A root was the one caller that did
 * not get that edge, so its tree was an unresolved root and everything below went unjudged — and
 * `@ramonda/testing-library`'s `render` carried two ignores for a design that is right.
 */
describe("a root that calls a helper", () => {
  test("reaches what the helper mounts, so a consumer below it is judged", () => {
    expect(run().issues.map((issue) => `${issue.consumer}: ${issue.path.join(" → ")}`)).toEqual([
      "Reader: shell → Reader",
    ]);
  });

  test("is no hole, and a parameter the helper mounts is the caller's; a call to anything else still is one", () => {
    expect(run().unresolved.map((hole) => `${hole.what}:${hole.line}`)).toEqual(["bootstrap:26"]);
  });
});

/**
 * `@ramonda/testing-library`'s `renderHook` declares `HookHost` inside itself and mounts it through
 * `render`, whose parameter the graph records as the caller's and does not fill — calls are not
 * followed. A component declared inside an exported function cannot exist without it, so it is
 * entered through that export, as an exported component is.
 */
test("a component declared inside an exported function is reached through it; inside one nothing exports, it is not", () => {
  expect(run().unreachable.map((dead) => dead.name)).toEqual(["hidden", "Lost"]);
});

/**
 * A root in a DEPENDENCY compiled from source says nothing about this project. "No root, no verdict"
 * counted every root in the program, so the router — which compiles the testing library from source —
 * became an app the moment that library's `render` got a root, and its own published components were
 * reported as nothing mounting them.
 */
test("a root in a dependency does not make a library an app", () => {
  const library = analyzeProject(join(here, "fixtures", "foreign-root", "tsconfig.json"));
  expect(library.unreachable.map((dead) => dead.name)).toEqual([]);
  // And its graph is a library's, so an app can splice it in: an app's graph is refused as a fragment.
  expect(library.graph.scope).toBe("library");
});
