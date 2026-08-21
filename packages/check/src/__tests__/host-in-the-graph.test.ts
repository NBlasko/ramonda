import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const graph = () => analyzeProject(join(here, "fixtures", "host-nesting", "tsconfig.json")).graph;

/**
 * The element each component IS, carried as a FACT so rules can be built on it.
 *
 * The graph's own note is that it holds facts and not conclusions, and this is one more of them.
 * Nothing reads it yet beyond `host-tag-is-not-an-element`, and that is the point: a rule that wants
 * to know what element a component becomes at a particular call site now has somewhere to ask,
 * rather than each one re-deriving it from the decorator.
 */
describe("the host element in the graph", () => {
  const nodeNamed = (name: string) => graph().nodes.find((node) => node.name === name);

  test("a settled tag is on the node, whether it is written or named", () => {
    expect(nodeNamed("Table")?.host).toEqual({ tag: "table" });
    // `@Host(TABLE)` where `const TABLE = "table"` — the same host one name away.
    expect(nodeNamed("NamedTable")?.host).toEqual({ tag: "table" });
    // Case is kept: SVG names are case-sensitive, so this is the element and `clippath` is not.
    expect(nodeNamed("Clip")?.host).toEqual({ tag: "clipPath" });
  });

  /**
   * A tag computed from ONE prop cannot be settled by the class — it is a `<section>` at one call
   * site and a `<div>` at the next — so the class says which prop decides and what it falls back to.
   */
  test("a tag the class leaves to a prop says which prop, and the default", () => {
    expect(nodeNamed("FromProps")?.host).toEqual({ fromProp: "as", fallback: "div" });
  });

  /**
   * And the call site says the rest. On the EDGE and not the node, for the reason `binds` is there:
   * a value handed over belongs to a call, and a node carrying one of two answers would be wrong
   * about the other half the time.
   */
  test("each call site carries the element it actually mounts", () => {
    const mounts = graph()
      .edges.filter((edge) => edge.to?.endsWith("#FromProps"))
      .map((edge) => edge.hostTag);

    // `as="dvi"`, `as="table"`, and one that names no prop at all — which is the fallback.
    expect(mounts).toEqual(["dvi", "table", "div"]);
  });

  /**
   * A callback this cannot settle leaves the node with no `host` at all, and a missing one is
   * "not knowable here" rather than "no host" — every component has one.
   */
  test("a tag no single answer fits is absent rather than guessed", () => {
    expect(nodeNamed("Computed")?.host).toBeUndefined();
  });
});
