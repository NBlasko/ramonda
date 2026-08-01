import type { VNode } from "@ramonda/core";

export type RouteParams = Record<string, string>;

// --- One-off string matching (convenience / tests) -------------------------

/**
 * Extracts `:param` values from a pathname given a route pattern.
 * e.g. matchParams("/players/123", "/players/:id") → { id: "123" }.
 * Returns null if the pattern doesn't match. Compiles a regex each call — for
 * the hot path use `createRoutes` + `matchCompiled` instead.
 */
export function matchParams(pathname: string, pattern: string): RouteParams | null {
  const { regex, paramNames } = compilePattern(pattern);
  const values = regex.exec(pathname);
  if (!values) return null;

  const params: RouteParams = {};
  paramNames.forEach((name, i) => {
    params[name] = values[i + 1];
  });
  return params;
}

/** Finds the first matching route key for a pathname (or "*"). */
export function matchRoute(pathname: string, routeKeys: string[]): { key: string; params: RouteParams } {
  for (const key of routeKeys) {
    if (key === "*") continue;
    const params = matchParams(pathname, key);
    if (params) return { key, params };
  }
  return { key: "*", params: {} };
}

// --- Precompiled matching (hot path) ---------------------------------------

interface CompiledRoute {
  key: string;
  regex: RegExp;
  paramNames: string[];
  vnode: VNode;
}

/**
 * A routes map compiled ONCE: regexes prebuilt, order preserved.
 *
 * `Paths` is a PHANTOM type parameter — nothing at runtime carries it. It exists so
 * `createRoutes` can remember the literal path keys it was given (`"/" | "/u/:id"`),
 * and `createRouter` can type `<Link href>` and `route()` against them. It defaults to
 * `string`, so every existing consumer that takes a plain `RouteConfig` keeps working
 * and a `RouteConfig<"/a" | "/b">` is assignable to `RouteConfig` (a narrower phantom is
 * assignable to the wider default).
 */
export interface RouteConfig<Paths extends string = string> {
  compiled: CompiledRoute[];
  fallback: VNode | undefined; // the "*" route
  /** Phantom: the literal path union, read by `createRouter`. Never set at runtime. */
  readonly __paths?: Paths;
}

/** The navigable path union of a config — every declared key except the `"*"` fallback. */
export type PathOf<C> = C extends RouteConfig<infer P> ? Exclude<P, "*"> : never;

function compilePattern(pattern: string): {
  regex: RegExp;
  paramNames: string[];
} {
  const paramNames = (pattern.match(/:\w+/g) ?? []).map((p) => p.slice(1));
  const regex = new RegExp("^" + pattern.replace(/:\w+/g, "([\\w-]+)") + "$");
  return { regex, paramNames };
}

/**
 * Compiles a routes map into a stable `RouteConfig` — call it ONCE (module
 * scope), then pass the result to <Router>. Two wins: regexes are built a single
 * time (not per render/match), and the stable object identity lets <Router>'s
 * shallow props comparison skip re-rendering when the parent re-renders.
 */
export function createRoutes<const T extends Record<string, VNode>>(routes: T): RouteConfig<Extract<keyof T, string>> {
  const compiled: CompiledRoute[] = [];
  let fallback: VNode | undefined;

  for (const [key, vnode] of Object.entries(routes)) {
    if (key === "*") {
      fallback = vnode;
      continue;
    }
    const { regex, paramNames } = compilePattern(key);
    compiled.push({ key, regex, paramNames, vnode });
  }

  return { compiled, fallback };
}

/** Matches a pathname against a precompiled config (no regex building here). */
export function matchCompiled(
  pathname: string,
  config: RouteConfig,
): { vnode: VNode | undefined; params: RouteParams; key: string } {
  for (const route of config.compiled) {
    const values = route.regex.exec(pathname);
    if (values) {
      const params: RouteParams = {};
      route.paramNames.forEach((name, i) => {
        params[name] = values[i + 1];
      });
      return { vnode: route.vnode, params, key: route.key };
    }
  }
  return { vnode: config.fallback, params: {}, key: "*" };
}

/** Every path a static build should render, split by whether it is knowable. */
export interface RoutePaths {
  /**
   * Literal paths, ready to render — every route with no `:param` in it, plus
   * whatever `extra` was passed.
   */
  paths: readonly string[];
  /**
   * Patterns this cannot enumerate, because the values live in your data:
   * `/players/:id` is one route and any number of pages. Render these by
   * passing the concrete paths as `extra`.
   *
   * Not an error, and not empty for most real sites — it is the list of things
   * the build has to be told about, so a build script can fail loudly instead of
   * quietly shipping a site missing half its pages.
   */
  needsData: readonly string[];
}

/**
 * Lists the paths a static build should prerender.
 *
 * ```ts
 * const { paths, needsData } = routePaths(routes, players.map((p) => `/players/${p.id}`));
 * if (needsData.length && extra.length === 0) throw new Error(…);
 * for (const path of paths) { …render… }
 * ```
 *
 * **The split is the point.** A router's route table is a set of PATTERNS, and
 * only some of them are pages. `/guide/state` is one page; `/players/:id` is one
 * route and however many players there are. A build that enumerated the table
 * and stopped would silently ship a site missing everything dynamic — and
 * nothing about the output would look wrong, because the pages it did emit are
 * all correct.
 *
 * `*` is excluded. It is the fallback for paths that match nothing, so it has no
 * URL of its own; if you want a 404 page, render one explicitly at whatever path
 * your host expects (`/404.html` for most static hosts).
 *
 * @param extra concrete paths for the `needsData` patterns, appended in order
 */
export function routePaths(config: RouteConfig, extra: readonly string[] = []): RoutePaths {
  const paths: string[] = [];
  const needsData: string[] = [];

  for (const route of config.compiled) {
    if (route.paramNames.length > 0) needsData.push(route.key);
    else paths.push(route.key);
  }

  return { paths: [...paths, ...extra], needsData };
}
