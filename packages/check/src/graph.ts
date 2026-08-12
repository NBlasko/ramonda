/**
 * The composition graph: which components exist, and which one can mount which.
 *
 * **Facts, not conclusions.** Nodes and edges, including the edges that could NOT be resolved, each
 * with the reason and the place. No issues and no paths — the graph is small, the set of paths
 * through it is not, and a rule that computes paths needs no change to this format when the next
 * rule arrives.
 *
 * A format rather than an API, so it is versioned and not documented for anyone else to write
 * against yet. `analyzeProject` returns it and `ramonda-check --graph <file>` writes it; nothing
 * else reads it.
 */

/** A place, relative to the directory holding the tsconfig — `src/App.tsx:12:3`. */
export type Where = string;

export interface GraphNode {
  /**
   * `<file>#<Name>`, the file relative to the project root — `src/pages/settings.tsx#Page`.
   *
   * The file and not the name alone: this repository's documentation app declares `class Page`
   * seventy-five times. The line is deliberately NOT part of it, so moving a class down a file
   * leaves the graph's identities alone and a diff between two commits says what actually moved.
   * A name declared twice in one file takes a `$2` suffix.
   */
  id: string;
  kind: "component" | "hook" | "context" | "root";
  /** The class or binding name. A root has none — it is a call, not a declaration. */
  name?: string;
  at: Where;
  /** A context's label, which is what a message calls it. */
  label?: string;
  /** The binding names of the pair, so a message can say which one to mount. */
  provider?: string;
  consumer?: string;
  /** `createContext(…, { optional: true })` — no provider above it is a legitimate arrangement. */
  optional?: boolean;
}

/**
 * `kind` is what a walk reads; `via` is how it was written, which only a message needs.
 *
 * Splitting them is what keeps the format still when a new way of naming a component arrives: it
 * adds a `via` value, and every reader that switches on `kind` is unaffected.
 */
export interface GraphEdge {
  from: string;
  /** Absent on an `unresolved` edge, which is the whole point of that kind. */
  to?: string;
  kind: "renders" | "provides" | "consumes" | "uses" | "unresolved";
  via: "tag" | "children" | "as" | "route" | "lazy" | "bootstrap" | "use";
  at: Where;
  /** Why nothing could be named, on an `unresolved` edge. */
  why?: string;
}

export interface ComponentGraph {
  schema: 1;
  /**
   * An app has roots and can be judged whole. A library has none — "unreachable" and "no provider
   * above" cannot be decided without knowing what mounts it — so its graph is a fragment.
   */
  scope: "app" | "library";
  package: { name: string; version: string };
  /**
   * Over the sources this graph was read from, so a graph older than the code it describes can be
   * refused rather than trusted. A map with unmarked blanks is worse than no map.
   */
  hash: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}
