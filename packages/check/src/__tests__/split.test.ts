import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";
import { diffGraphs, refuseToDiff } from "../diff";
import type { ComponentGraph, GraphEdge, GraphNode } from "../graph";
import { filesOf, splitOf } from "../split";

const here = dirname(fileURLToPath(import.meta.url));
const run = (name: string) => analyzeProject(join(here, "fixtures", name, "tsconfig.json"));

/** The fixture's directory off the front of an id, so an expectation is readable. */
const short = (name: string) => (id: string) => id.replace(`@ramonda/check/src/__tests__/fixtures/${name}/`, "");

/**
 * A graph written by hand, for the properties that need an arrangement no fixture has — two
 * versions of one app, a schema that does not match. Every id here is `<file>#<Name>`, the shape
 * the emitter produces, because `splitOf` reads the file out of it.
 */
const graphOf = (nodes: GraphNode[], edges: GraphEdge[], over: Partial<ComponentGraph> = {}): ComponentGraph => ({
  schema: 1,
  scope: "app",
  package: { name: "app", version: "0.0.0" },
  hash: "sha256:0",
  nodes,
  edges,
  ...over,
});

const node = (id: string, kind: GraphNode["kind"] = "component"): GraphNode => ({
  id,
  kind,
  name: id.split("#")[1],
  at: `${id.split("#")[0]}:1:1`,
});

// `lazy` is a `via`, not a `kind`: mounting is mounting, and how it was written is the other axis.
const edge = (from: string, to: string, via: GraphEdge["via"] = "tag"): GraphEdge => ({
  from,
  to,
  kind: "renders",
  via,
  at: `${from.split("#")[0]}:1:1`,
});

describe("where the app splits, and what each piece carries", () => {
  /**
   * The three-way split is the whole answer, and each part is a different claim: `already` costs
   * nothing, `shared` is downloaded once for several points, `its own` is what this one alone pays.
   * Collapsing any two of them would report a page as expensive when it is free.
   */
  test("a chunk's reach is split into already loaded, shared, and its own", () => {
    const { graph } = run("payload");
    const id = short("payload");
    const split = splitOf(graph);

    // Two lazy specifiers, three sites — `left` is named twice and is still one download.
    expect(split.points.map((p) => id(p.id)).sort()).toEqual(["chunks/left.tsx#Page", "chunks/right.tsx#Page"]);

    const left = split.points.find((p) => p.id.endsWith("chunks/left.tsx#Page"));
    expect(left?.sites).toHaveLength(2);
    // `Header` is in the first payload already; `Shared` is reached by the other chunk too;
    // `Page` and `OnlyLeft` are this chunk's alone.
    expect(left?.loaded).toBe(1);
    expect(left?.shared).toBe(1);
    expect(left?.own.map(id).sort()).toEqual(["chunks/left.tsx#OnlyLeft", "chunks/left.tsx#Page"]);

    const right = split.points.find((p) => p.id.endsWith("chunks/right.tsx#Page"));
    expect(right?.own.map(id)).toEqual(["chunks/right.tsx#Page"]);
    expect(split.shared.map((s) => id(s.id))).toEqual(["shared.tsx#Shared"]);
    expect(split.shared[0]?.by).toBe(2);
  });

  test("the first payload holds what a root reaches without crossing a lazy edge", () => {
    const { graph } = run("payload");
    const id = short("payload");
    const initial = splitOf(graph).initial.map(id);

    expect(initial).toContain("app.tsx#Shell");
    expect(initial).toContain("header.tsx#Header");
    // Behind a lazy edge, so the browser has none of it until something asks.
    expect(initial).not.toContain("chunks/left.tsx#Page");
    expect(initial).not.toContain("shared.tsx#Shared");
  });

  /**
   * A file is what a bundler moves, so the count that means anything alongside declarations is
   * files — and two declarations in one file are one file.
   */
  test("declarations are counted by file as well", () => {
    expect(filesOf(["a.tsx#One", "a.tsx#Two", "b.tsx#Three"])).toBe(2);
  });

  test("an app with nothing lazy has one payload and says so", () => {
    const split = splitOf(
      graphOf(
        [node("main.tsx#root", "root"), node("app.tsx#App"), node("app.tsx#Panel")],
        [edge("main.tsx#root", "app.tsx#App", "bootstrap"), edge("app.tsx#App", "app.tsx#Panel")],
      ),
    );
    expect(split.points).toEqual([]);
    // Two declarations and not three: the root is a CALL, walked through and never counted.
    expect(split.initial).toEqual(["app.tsx#App", "app.tsx#Panel"]);
  });

  /**
   * A library has no root, so there is no "first". Reporting an empty payload as a fact would read
   * as "this package loads nothing", which is a different and false claim — the CLI says the other
   * thing instead, and this pins the input it says it about.
   */
  test("a library graph has no first payload at all", () => {
    const split = splitOf(graphOf([node("index.tsx#Grid")], [], { scope: "library" }));
    expect(split.initial).toEqual([]);
    expect(split.points).toEqual([]);
  });
});

/**
 * An app entered only from a server used to pass in silence, which is the failure the whole design
 * is against: with no root the run judged nothing and still printed "every consumer has a provider
 * above it". Measured on one file — the same code with `bootstrap` reported the broken path.
 */
describe("an app entered only from a server", () => {
  test("is judged, and its broken path is named", () => {
    const { issues, counts } = run("ssr-root");
    expect(counts.roots).toBe(1);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.consumer).toBe("Reader");
    expect(issues[0]?.path).toEqual(["App", "Reader"]);
  });

  /**
   * A component METHOD of the same name is not an entry. Two apps in this repository have one, and
   * read by name each `this.renderPage(row)` would be a root whose argument is a row of data.
   */
  test("a method called renderPage is not a root", () => {
    const { graph, unresolved } = run("ssr-root");
    const roots = graph.nodes.filter((n) => n.kind === "root");
    expect(roots.map((r) => r.at.replace(/.*ssr-root\//, ""))).toEqual(["app.tsx:41:22", "app.tsx:45:23"]);
    expect(unresolved).toEqual([]);
  });
});

describe("what changed between two graphs", () => {
  const before = graphOf(
    [node("main.tsx#root", "root"), node("app.tsx#App"), node("heavy.tsx#Heavy")],
    [edge("main.tsx#root", "app.tsx#App", "bootstrap"), edge("app.tsx#App", "heavy.tsx#Heavy", "lazy")],
  );

  /**
   * The number this file exists for: one line moved, and a chunk's worth of code is now downloaded
   * before anything is on screen. Nothing in a source diff says it.
   */
  test("a declaration that stopped being lazy is named", () => {
    const after = graphOf(before.nodes, [
      edge("main.tsx#root", "app.tsx#App", "bootstrap"),
      edge("app.tsx#App", "heavy.tsx#Heavy", "tag"),
    ]);
    const change = diffGraphs(before, after);

    expect(change.initialBefore).toBe(1);
    expect(change.initialAfter).toBe(2);
    expect(change.intoInitial.map((n) => n.id)).toEqual(["heavy.tsx#Heavy"]);
    expect(change.outOfInitial).toEqual([]);
  });

  test("and the reverse — something made lazy leaves the first payload", () => {
    const eager = graphOf(before.nodes, [
      edge("main.tsx#root", "app.tsx#App", "bootstrap"),
      edge("app.tsx#App", "heavy.tsx#Heavy", "tag"),
    ]);
    const change = diffGraphs(eager, before);
    expect(change.outOfInitial.map((n) => n.id)).toEqual(["heavy.tsx#Heavy"]);
    expect(change.intoInitial).toEqual([]);
  });

  /**
   * Identity leaves the LINE out, on nodes and on edges alike. Inserting a line near the top of a
   * file would otherwise move everything below it, and a report where everything changed is one
   * nobody reads a second time.
   */
  test("moving a tag down a file is not a change", () => {
    const moved = graphOf(before.nodes, [
      { ...(before.edges[0] as GraphEdge), at: "main.tsx:99:1" },
      { ...(before.edges[1] as GraphEdge), at: "app.tsx:42:7" },
    ]);
    const change = diffGraphs(before, moved);
    expect(change.edgesAdded).toEqual([]);
    expect(change.edgesRemoved).toEqual([]);
    expect(change.nodesAdded).toEqual([]);
  });

  test("the same sources are recognised by their hash", () => {
    expect(diffGraphs(before, before).identical).toBe(true);
    expect(diffGraphs(before, graphOf(before.nodes, before.edges, { hash: "sha256:1" })).identical).toBe(false);
  });

  /**
   * Two graphs of different things subtract to nonsense, and a number nobody can trust is worse
   * than no number. Each refusal names what it saw rather than saying "mismatch".
   */
  test("a graph of something else is refused rather than compared", () => {
    expect(refuseToDiff(before, before)).toBeUndefined();
    expect(refuseToDiff(before, graphOf(before.nodes, before.edges, { schema: 2 as 1 }))).toMatch(/schema 1.*schema 2/);
    expect(refuseToDiff(before, graphOf(before.nodes, before.edges, { scope: "library" }))).toMatch(/library graph/);
    expect(
      refuseToDiff(before, graphOf(before.nodes, before.edges, { package: { name: "other", version: "0.0.0" } })),
    ).toMatch(/is app and this one is other/);
  });

  test("a node added and a node deleted are both reported", () => {
    const after = graphOf([...before.nodes.slice(0, 2), node("new.tsx#Fresh")], before.edges.slice(0, 1));
    const change = diffGraphs(before, after);
    expect(change.nodesAdded.map((n) => n.id)).toEqual(["new.tsx#Fresh"]);
    expect(change.nodesRemoved.map((n) => n.id)).toEqual(["heavy.tsx#Heavy"]);
  });
});
