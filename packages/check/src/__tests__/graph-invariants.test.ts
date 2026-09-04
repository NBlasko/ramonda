import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = (name: string) => analyzeProject(join(here, "fixtures", name, "tsconfig.json"));

/**
 * Chosen for their shapes rather than their names: a dead declaration and a used hook, an opaque
 * node, a clean app, slot bindings, a lazy boundary, and the two params fixtures whose hooks read
 * the URL. Not all 137 — each one builds a program, and breadth past this buys nothing these do not
 * already cover.
 */
const FIXTURES = ["unreachable", "holes", "ok", "slots", "lazy", "params-through-a-hook", "params-claims-a-key"];

/**
 * What the exported graph promises about ITSELF, which nothing was asking.
 *
 * **Why this file exists.** `closeOverHooks` (2026-09-04) changed what every consumer of the walk
 * reads — `reached`, `routesAbove`, `pathTo` — and deleted two hand-rolled closures that had been
 * patching the same hole locally. `analyze.test.ts` has 19 assertions about the graph across its 113
 * tests, and they cover node kinds, `renders` edges, `via`, slot bindings and lazy holes. **None of
 * them mentions a `uses` edge**, which is the one the change was about.
 *
 * Measured before writing any of this, by swapping in `analyze.ts` and `cli.ts` from the commit
 * before the change and re-exporting: the graph for `apps/docs` (350 nodes, 895 edges, 19 hooks, 14
 * `uses` edges) and for `apps/playground-core` (80 nodes, 125 edges, 22 hooks, 20 `uses` edges) came
 * out **byte-identical**, `sha256 04cc9815…` and `sha256 3e4c48d7…`. So nothing was broken. What was
 * missing is anything that would have said so.
 *
 * **One invariant is deliberately NOT here: that no two nodes share an id.** It was written, and
 * then measured: with `oneEach` taken out of the export, nine fixtures — `unreachable`, `holes`,
 * `ok`, `slots`, `lazy`, `cross-package`, `vendor-ui`, `fragment`, `params-through-a-hook` — produce
 * zero duplicates between them. So the assertion could not fail, and a test that cannot fail is a
 * claim about coverage rather than about the code. The dedupe is defensive for a shape none of these
 * reach: its own comment names an unpruned library fragment carrying another package's classes, and
 * fragments are pruned now. Building a fixture that reaches it is the way to earn the test.
 *
 * These are PROPERTIES rather than a snapshot. A count of nodes churns whenever a fixture gains a
 * line and teaches nobody anything; "every edge points at a node this graph declares" holds for any
 * fixture and fails the moment the export starts lying about itself.
 */
describe("what the exported graph promises about itself", () => {
  test("every edge points at a node the graph declares", () => {
    for (const name of FIXTURES) {
      const graph = run(name).graph;
      const declared = new Set(graph.nodes.map((node) => node.id));

      for (const edge of graph.edges) {
        expect(declared, `${name}: edge from ${edge.from}`).toContain(edge.from);
        // An `unresolved` edge is a hole on purpose: it records a site whose target could not be
        // named, and its `to` is absent. That is the one edge allowed to point nowhere.
        if (edge.kind === "unresolved") continue;
        expect(declared, `${name}: edge to ${edge.to} (${edge.kind})`).toContain(edge.to);
      }
    }
  });

  test("a hook a component uses is exported as a `uses` edge to a hook node", () => {
    const graph = run("params-through-a-hook").graph;
    const kindOf = new Map(graph.nodes.map((node) => [node.id, node.kind]));
    const uses = graph.edges.filter((edge) => edge.kind === "uses");

    // A floor, because every assertion under it is over a list: with no `uses` edge the loop below
    // passes on nothing, which is the shape of a test that has stopped testing.
    expect(uses.length).toBeGreaterThan(0);

    for (const edge of uses) {
      expect(edge.via, `${edge.from} -> ${edge.to}`).toBe("use");
      expect(kindOf.get(edge.to as string), `${edge.to} is used, so it is a hook`).toBe("hook");
    }
  });

  test("a hook reached ONLY through use() is in the graph and is not called dead", () => {
    // The two answers the change unified. `TeamData` mounts nothing and nothing mounts it: the walk
    // that follows mounts never arrives, and it is reached only because `TeamPage` uses it.
    const result = run("params-through-a-hook");

    expect(result.graph.nodes.map((node) => node.name)).toContain("TeamData");
    expect(result.unreachable.map((issue) => issue.name)).not.toContain("TeamData");
    // And the one nothing uses IS dead, so the answer above is not simply "hooks are never dead".
    expect(result.unreachable.map((issue) => issue.name)).toContain("OrphanData");
  });

  test("every fixture here exports a graph with a root, so none of them is a library by accident", () => {
    for (const name of FIXTURES) {
      const graph = run(name).graph;

      expect(graph.scope, `${name}`).toBe("app");
      expect(graph.nodes.filter((node) => node.kind === "root").length, `${name} has no root`).toBeGreaterThan(0);
    }
  });
});
