/**
 * What changed between two graphs, and — the reason this exists — what a change moved into or out
 * of the first payload.
 *
 * "This change pulled forty components into the initial bundle" is a sentence no review catches by
 * reading a diff of the source: the import that did it is one line in one file, and the cost is
 * paid somewhere else entirely. Two graphs make it arithmetic.
 *
 * **Identity ignores the line, on both sides.** A node id already leaves the line out so that
 * moving a class down a file is not a change; an edge is compared the same way, on
 * `from → to (kind/via)`. A report where every edge below an inserted line has moved is a report
 * nobody reads twice.
 */
import type { ComponentGraph, GraphEdge, GraphNode } from "./graph";
import { splitOf } from "./split";

export interface GraphDiff {
  /** The two graphs are the same bytes — the source they were read from did not change. */
  identical: boolean;
  nodesAdded: GraphNode[];
  nodesRemoved: GraphNode[];
  /** One entry per distinct `from → to (kind/via)`, whatever line it is written on. */
  edgesAdded: GraphEdge[];
  edgesRemoved: GraphEdge[];
  /** Declarations the browser has before it does anything, then and now. */
  initialBefore: number;
  initialAfter: number;
  /** In the first payload now and not before — the number this whole file is for. */
  intoInitial: GraphNode[];
  /** No longer in it: something was made lazy, or deleted. */
  outOfInitial: GraphNode[];
}

const edgeKey = (edge: GraphEdge): string => `${edge.from} -> ${edge.to ?? "?"} (${edge.kind}/${edge.via})`;

/**
 * Why a graph can be refused rather than compared: two graphs of different things subtract to
 * nonsense, and a diff nobody can trust is worse than no diff.
 */
export function refuseToDiff(before: ComponentGraph, after: ComponentGraph): string | undefined {
  if (before.schema !== after.schema) {
    return `the saved graph is schema ${before.schema} and this one is schema ${after.schema}`;
  }
  if (before.scope !== after.scope) {
    return `the saved graph is a ${before.scope} graph and this one is an ${after.scope} graph`;
  }
  if (before.package.name !== after.package.name) {
    return `the saved graph is ${before.package.name} and this one is ${after.package.name}`;
  }
  return undefined;
}

export function diffGraphs(before: ComponentGraph, after: ComponentGraph): GraphDiff {
  const was = new Map(before.nodes.map((node) => [node.id, node]));
  const now = new Map(after.nodes.map((node) => [node.id, node]));

  const wasEdges = new Map(before.edges.map((edge) => [edgeKey(edge), edge]));
  const nowEdges = new Map(after.edges.map((edge) => [edgeKey(edge), edge]));

  const beforePayload = new Set(splitOf(before).initial);
  const afterPayload = new Set(splitOf(after).initial);

  /**
   * A declaration that arrived in the payload BY BEING NEW is not the interesting case — the one
   * worth a sentence is code that already existed and is now downloaded up front. Both are listed,
   * because deleting the distinction would hide a page that stopped being lazy, but the node is
   * carried so a reader can see which it is.
   */
  const intoInitial = [...afterPayload].filter((id) => !beforePayload.has(id)).map((id) => now.get(id));
  const outOfInitial = [...beforePayload].filter((id) => !afterPayload.has(id)).map((id) => was.get(id));

  const present = <T>(list: (T | undefined)[]): T[] => list.filter((item): item is T => item !== undefined);
  const byId = (a: GraphNode, b: GraphNode) => a.id.localeCompare(b.id);

  return {
    identical: before.hash === after.hash,
    nodesAdded: after.nodes.filter((node) => !was.has(node.id)).sort(byId),
    nodesRemoved: before.nodes.filter((node) => !now.has(node.id)).sort(byId),
    edgesAdded: [...nowEdges].filter(([key]) => !wasEdges.has(key)).map(([, edge]) => edge),
    edgesRemoved: [...wasEdges].filter(([key]) => !nowEdges.has(key)).map(([, edge]) => edge),
    initialBefore: beforePayload.size,
    initialAfter: afterPayload.size,
    intoInitial: present(intoInitial).sort(byId),
    outOfInitial: present(outOfInitial).sort(byId),
  };
}
