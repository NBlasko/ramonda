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
  /**
   * `helper` is a function that returns JSX, written outside any component class.
   *
   * Not a component — nothing mounts it and it has no context of its own — but the tags in its
   * body are edges and they belong somewhere. Whoever CALLS it reaches them.
   */
  kind: "component" | "hook" | "context" | "root" | "helper";
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
  /**
   * Whether an app can name this — only an exported class can be mounted from outside.
   *
   * Carried in a library's fragment, where it is the difference between the surface and the
   * internals. The internals are in the fragment too, and deliberately: a report that names the
   * real path THROUGH a package — `App > DataGrid > PagedBody` — is worth more than one that says
   * `DataGrid requires Query`.
   */
  exported?: boolean;
  /**
   * The package refused to judge below this one — it does something its own run could not follow.
   *
   * Carried so an app splicing the fragment stops where the package stopped. Without it every
   * spliced node read as transparent, and the app reported consumers under a component whose hook
   * may well have been providing for them.
   */
  opaque?: boolean;
  /**
   * Prop paths this component's type declares as taking a component — `view`,
   * `spec.columns[].cell`.
   *
   * A path and not a name, because a slot can sit at any depth in a prop, and depth 1 and depth 5
   * are then the same mechanism with a longer string. Read from the type as SYNTAX: a mapped type
   * and a function returning a component are the two shapes this cannot answer, and both are out
   * of scope rather than approximated.
   */
  slots?: string[];
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
  kind: "renders" | "provides" | "consumes" | "uses" | "calls" | "unresolved";
  via: "tag" | "children" | "route" | "lazy" | "slot" | "factory" | "bootstrap" | "use" | "call";
  at: Where;
  /** Why nothing could be named, on an `unresolved` edge. */
  why?: string;
  /**
   * What THIS site hands to the mounted component's slots.
   *
   * On the edge and not on the node, because a binding belongs to a call: `<Slot view={Reader} />`
   * in one place and `<Slot view={Writer} />` in another are two arrangements, and a walk that
   * merged them would make each reachable from the other.
   */
  binds?: { slot: string; to: string }[];
  /**
   * The prop a `via: "slot"` edge is waiting on — `<this.props.view />`.
   *
   * Unresolvable from the class alone, and that is not a defect: the caller decides. A walk
   * arriving with a binding for this path fills it, and one arriving without leaves it a hole.
   */
  slot?: string;
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
  /**
   * The declaration file an app actually imports, and its hash — a library's fragment only.
   *
   * The source hash above cannot be checked by a consumer, which has `dist` and nothing else. So
   * the fragment also fingerprints what the consumer CAN see: rebuild the package without
   * regenerating its graph and the app refuses the fragment instead of trusting a map of code that
   * is gone.
   */
  describes?: { file: string; hash: string };
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * How an app finds a package's fragment: the `ramonda.graph` field of its `package.json`.
 *
 * A field rather than a fixed path in `dist`, because an `exports` map already differs from
 * package to package — one place both a tool and a person read.
 *
 * ```json
 * { "name": "@acme/ui", "ramonda": { "graph": "./dist/graph.json" } }
 * ```
 */
export interface PackageGraphField {
  ramonda?: { graph?: string };
}
