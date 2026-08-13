/**
 * Where the app splits, and what each piece carries — computed from the graph, with no second walk
 * over the source.
 *
 * **A bundler splits at a dynamic import and nowhere else**, so in this graph it splits at a `lazy`
 * edge and nowhere else. That is the whole model, and it is a model of what actually ships rather
 * than a proxy for it: whatever a bundler can code-split, this analyzer resolved, because both are
 * reading the same literal specifier.
 *
 * **Routes are deliberately not the unit, and that is a measurement rather than a preference.** The
 * plan called this "what one route pulls in". Measured on this repository: `playground-core` imports
 * all eleven of its pages statically, so every one is in the first payload and opening a route costs
 * nothing to download; and the documentation site's route table is built in a loop from `page.path`,
 * so no route in it has a URL this can name. Splitting by route would have answered a question the
 * graph cannot ask and missed the one it can.
 *
 * **What this deliberately does not say is bytes.** A declaration is not a size, a file holds more
 * than the declarations in this graph, and nothing here has weighed a bundle. It counts
 * declarations and names files, and a reader who wants kilobytes has a bundler that will tell them.
 */
import type { ComponentGraph, Where } from "./graph";

/** One lazily loaded declaration, with what arrives when it does. */
export interface SplitPoint {
  id: string;
  name: string;
  /**
   * The file it is declared in, with this project's own package name stripped off the front.
   *
   * Not decoration: a name alone identifies nothing here. This repository's documentation site
   * declares `class Page` seventy-six times, once per generated page, so a report listing them by
   * name is seventy-six identical rows. A name from ANOTHER package keeps its prefix, because
   * which package it came from is the useful half.
   */
  file: string;
  /**
   * Every place a `lazy` prop names it. More than one is ordinary — a component loaded from two
   * pages is written twice and downloaded once.
   */
  sites: Where[];
  /** Everything it reaches without crossing another `lazy` edge. The three counts below partition it. */
  reach: number;
  /** Already in the first payload, so arriving here costs nothing. */
  loaded: number;
  /** Some other split point reaches it too, so it lands in a chunk they share. */
  shared: number;
  /** Reached from here and nowhere else. */
  own: string[];
}

export interface Split {
  /** What a root reaches without crossing a `lazy` edge — what the browser has before it does anything. */
  initial: string[];
  points: SplitPoint[];
  /**
   * Reached by more than one split point and absent from the first payload, most widely shared
   * first — the declarations a bundler hoists into a chunk several others pull in.
   */
  shared: { id: string; name: string; by: number }[];
}

/**
 * Every edge that names another declaration pulls its module along, so all of them count — a hook
 * `use` and a context `consumes` as much as a tag. Only `unresolved` is left out, having no target.
 */
const outgoing = (graph: ComponentGraph): Map<string, { to: string; via: string }[]> => {
  const out = new Map<string, { to: string; via: string }[]>();
  for (const edge of graph.edges) {
    if (!edge.to || edge.kind === "unresolved") continue;
    const list = out.get(edge.from);
    if (list) list.push({ to: edge.to, via: edge.via });
    else out.set(edge.from, [{ to: edge.to, via: edge.via }]);
  }
  return out;
};

export function splitOf(graph: ComponentGraph): Split {
  const out = outgoing(graph);
  const names = new Map(graph.nodes.map((node) => [node.id, node.name ?? node.id]));

  /**
   * A root is walked THROUGH and never counted.
   *
   * It is a call, not a declaration — `bootstrap(<App />, el)` is a line, and what loads is `App`.
   * Counting it inflates the payload by the number of entry points, and an entry that resolved to
   * nothing would add weight that does not exist: a package's own `renderPage` forwards the tree it
   * was handed, so an app compiling core from source carries two such calls and neither downloads
   * anything.
   */
  const roots = new Set(graph.nodes.filter((node) => node.kind === "root").map((node) => node.id));

  /** One payload's worth: everything reachable from here that does not sit behind another `lazy`. */
  const payload = (from: Iterable<string>): Set<string> => {
    const seen = new Set<string>();
    const queue = [...from];
    while (queue.length > 0) {
      const id = queue.pop() as string;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const edge of out.get(id) ?? []) if (edge.via !== "lazy") queue.push(edge.to);
    }
    for (const id of roots) seen.delete(id);
    return seen;
  };
  const initial = payload(roots);

  // One point per TARGET, not per site: a component two pages load lazily is downloaded once.
  const sites = new Map<string, Where[]>();
  for (const edge of graph.edges) {
    if (edge.via !== "lazy" || !edge.to) continue;
    const list = sites.get(edge.to);
    if (list) list.push(edge.at);
    else sites.set(edge.to, [edge.at]);
  }

  const reachOf = new Map<string, Set<string>>();
  for (const target of sites.keys()) reachOf.set(target, payload([target]));

  /** How many split points reach each declaration — one means it belongs to that point alone. */
  const owners = new Map<string, number>();
  for (const reach of reachOf.values()) for (const id of reach) owners.set(id, (owners.get(id) ?? 0) + 1);

  const points: SplitPoint[] = [];
  for (const [target, reach] of reachOf) {
    const own: string[] = [];
    let loaded = 0;
    let shared = 0;
    for (const id of reach) {
      if (initial.has(id)) loaded++;
      else if ((owners.get(id) ?? 0) > 1) shared++;
      else own.push(id);
    }
    points.push({
      id: target,
      name: names.get(target) ?? target,
      file: fileOf(target, graph.package.name),
      sites: [...(sites.get(target) ?? [])].sort(),
      reach: reach.size,
      loaded,
      shared,
      own: own.sort(),
    });
  }
  points.sort((a, b) => b.own.length - a.own.length || b.reach - a.reach || a.id.localeCompare(b.id));

  const shared = [...owners]
    .filter(([id, by]) => by > 1 && !initial.has(id))
    .map(([id, by]) => ({ id, name: names.get(id) ?? id, by }))
    .sort((a, b) => b.by - a.by || a.id.localeCompare(b.id));

  return { initial: [...initial].sort(), points, shared };
}

/** How many distinct files a set of declarations lives in — a file is what a bundler moves. */
export const filesOf = (ids: readonly string[]): number => new Set(ids.map((id) => id.split("#")[0])).size;

/** `@ramonda/docs/src/DocPage.tsx#Page` → `src/DocPage.tsx`, for a node this project declares. */
const fileOf = (id: string, self: string): string => {
  const file = id.split("#")[0] ?? id;
  return file.startsWith(`${self}/`) ? file.slice(self.length + 1) : file;
};
