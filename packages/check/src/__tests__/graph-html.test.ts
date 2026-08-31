import { describe, expect, test } from "vitest";
import type { ComponentGraph } from "../graph";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";
import { graphHtml } from "../graph-html";

const here = dirname(fileURLToPath(import.meta.url));

const graph = (nodes: ComponentGraph["nodes"], edges: ComponentGraph["edges"] = []): ComponentGraph => ({
  schema: 1,
  scope: "app",
  package: { name: "@acme/app", version: "1.0.0" },
  hash: "abc",
  nodes,
  edges,
});

/**
 * The graph as one file you can open.
 *
 * Asserted on the OUTPUT rather than on a layout: where a box lands is arithmetic the browser does,
 * and pinning coordinates here would pin the picture rather than the claim. What has to hold is
 * that the file is self-contained, that it carries the whole graph, and that it survives the shapes
 * the graph actually produces.
 */
describe("the graph drawn as a page", () => {
  test("is one file that carries the graph and loads nothing", () => {
    const html = graphHtml(graph([{ id: "a.tsx#App", kind: "component", name: "App", at: "a.tsx:1:1" }]));

    expect(html).toContain("a.tsx#App");
    // Self-contained: no network, so a graph opened on a plane looks the same as one opened at a desk.
    expect(html).not.toMatch(/<script[^>]+src=|<link[^>]+stylesheet/);
  });

  /**
   * A ROOT HAS NO NAME, and the first version of this assumed one.
   *
   * `GraphNode.name` is optional and says why — *"a root has none: it is a call, not a
   * declaration"*. Written against `node.name` the viewer threw on the first `localeCompare` and
   * rendered a blank page with nothing in the console, which is the worst way for a picture to
   * fail: it looks like an app with no components rather than like a bug.
   *
   * The label falls back to the call the id ends in.
   */
  test("a root, which has no name, is labelled by the call that made it", () => {
    const html = graphHtml(graph([{ id: "entry.tsx#hydrateRoot", kind: "root", at: "entry.tsx:5:11" }]));

    expect(html).toContain("entry.tsx#hydrateRoot");
    expect(() => JSON.parse(embedded(html))).not.toThrow();
  });

  /**
   * The embedded graph has to survive being read back, and `<` is the one character that could end
   * the script tag early — a JSX name in a message, a generic in a label.
   */
  test("the embedded graph parses back, with `<` in the data", () => {
    const html = graphHtml(graph([{ id: "a.tsx#Box", kind: "component", name: "Box<T>", at: "a.tsx:1:1" }]));

    const back = JSON.parse(embedded(html)) as ComponentGraph;
    expect(back.nodes[0].name).toBe("Box<T>");
    expect(html).not.toContain("</script><");
  });
});

/**
 * And the graph itself hands each declaration over ONCE.
 *
 * Found by drawing it: the page reported 168 nodes and rendered 166 boxes, because a viewer reads
 * the graph into a map by id and two entries collapsed. `@ramonda/router`'s `Link` and `Navigator`
 * each arrived twice, byte for byte identical — a node can reach the list down more than one path,
 * and the two are different objects so the spliced-node check does not catch them.
 *
 * It matters most to `--diff`, which compares BY ID: one of a pair is invisible to it.
 */
describe("the graph it draws", () => {
  test("hands each declaration over once", () => {
    const graph = analyzeProject(join(here, "fixtures", "cross-package", "tsconfig.json")).graph;
    const ids = graph.nodes.map((node) => node.id);

    expect(ids).toHaveLength(new Set(ids).size);
  });
});

/** The JSON out of the `<script type="application/json">` the page carries it in. */
function embedded(html: string): string {
  const at = html.indexOf('type="application/json">');
  return html.slice(at + 'type="application/json">'.length, html.indexOf("</script>", at));
}
