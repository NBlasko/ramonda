import type { VNode } from "@ramonda/core";

export type RouteParams = Record<string, string>;

/**
 * The `:param` names a pattern declares, at the type level.
 *
 * Here rather than in `createRouter.ts` because BOTH sides need it now and `createRouter` imports
 * from `Router.tsx`, so a type living there could not travel back. `match.ts` is the leaf: it owns
 * `RouteParams` and `compilePattern`, which is the runtime half of exactly this question.
 */
export type ParamNames<P extends string> = P extends `${string}:${infer Name}/${infer Rest}`
  ? Name | ParamNames<`/${Rest}`>
  : P extends `${string}:${infer Name}`
    ? Name
    : never;

/** A pattern's params object — `"/u/:id"` → `{ id: string }`. */
export type ParamsOf<P extends string> = { [K in ParamNames<P>]: string };

/**
 * Holds a pattern named at a READ site to what the outlet above actually matched.
 *
 * The mirror of the throw in `route()`, which refuses to build `/u/undefined` when a param is
 * missing. Naming a pattern is a claim about which route this component stands on, and an unchecked
 * claim would hand back `undefined` typed as `string`.
 *
 * Deliberately NOT an equality check on the key. A component rendered by both `/users/:id` and
 * `/people/:id` names one and is correct on both, because what it asked for is satisfied on both —
 * the claim is about the params, not the spelling.
 */
export function assertPattern(pattern: string, params: RouteParams, matchedKey: string | undefined): void {
  const wanted = paramNamesOf(pattern);
  const missing = wanted.filter((name) => !(name in params));
  if (missing.length === 0) return;

  const named = missing.map((name) => `\`:${name}\``).join(", ");
  if (matchedKey === undefined) {
    throw new Error(
      `[Ramonda Router] params("${pattern}") was read with no <RouteOutlet> above this component, so ` +
        `there is no matched route and no ${named}. Params are published by the outlet that matched, ` +
        `which is why chrome beside the outlet — a nav bar, a header — has a pathname but no params. ` +
        `Move the read inside the routed page, or use \`pathname\` if this component is not part of a route.`,
    );
  }
  throw new Error(
    `[Ramonda Router] params("${pattern}") names ${named}, and the route this component is on — ` +
      `"${matchedKey}" — does not supply it. Reading it would give \`undefined\` where the type says ` +
      `\`string\`. Name the pattern this component is actually rendered by, or drop the argument and ` +
      `use \`params<T>()\` if it is rendered by routes that do not agree on their params.`,
  );
}

/** The `:param` names in a pattern, at runtime — the same scan `compilePattern` does. */
function paramNamesOf(pattern: string): string[] {
  return (pattern.match(/:\w+/g) ?? []).map((name) => name.slice(1));
}

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
