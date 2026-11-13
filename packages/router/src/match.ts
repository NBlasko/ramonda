import type { VNode } from "@ramonda/core";

export type RouteParams = Record<string, string>;

/**
 * The `:param` names a pattern declares, at the type level.
 *
 * Here rather than in `registry.ts` because BOTH sides need it now and `registry.ts` imports
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
 * and the registration can type `<Link href>` and `route()` against them. It defaults to
 * `string`, so every existing consumer that takes a plain `RouteConfig` keeps working
 * and a `RouteConfig<"/a" | "/b">` is assignable to `RouteConfig` (a narrower phantom is
 * assignable to the wider default).
 */
export interface RouteConfig<Paths extends string = string> {
  compiled: CompiledRoute[];
  fallback: VNode | undefined; // the "*" route
  /** Phantom: the literal path union, read by the registration. Never set at runtime. */
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
 * One part of a table: a module's compiled table, a literal one, or `undefined` — the empty part a
 * condition leaves (`import.meta.env.DEV ? debugRoutes : undefined`).
 */
export type RoutePart = RouteConfig<string> | Record<string, VNode> | undefined;

/** The paths one part names. A compiled table carries them in its phantom; a literal one as its keys. */
type PathsOfPart<P> =
  P extends RouteConfig<infer K> ? K : P extends Record<string, VNode> ? Extract<keyof P, string> : never;

/**
 * Compiles a routes map into a stable `RouteConfig` — call it ONCE (module scope), then pass the
 * result to <Router>. Regexes are built a single time, and the stable identity lets <Router>'s
 * shallow props comparison skip re-rendering when the parent re-renders.
 *
 * ## Parts
 *
 * `createRoutes(tournamentRoutes, authRoutes, { "/": <Home /> })`: a table assembled from the tables
 * its modules own and a literal one of its own, matched in the order given — see
 * `DESIGN-module-routes.md`. One literal table is the one-part case. A spread cannot do this: the
 * result is COMPILED, so `{ ...tournamentRoutes }` copied `compiled` and `fallback` as if they were
 * paths.
 *
 * ## Refused, when the table is built
 *
 * A path two parts both name, a second `"*"`, and a route an earlier pattern matches first — none of
 * them can ever be meant, and across files nobody sees them. Thrown at module load, so the first dev
 * server start or test run stops on it and it never ships.
 */
export function createRoutes<const T extends readonly RoutePart[]>(...parts: T): RouteConfig<PathsOfPart<T[number]>> {
  const compiled: (CompiledRoute & { part: number })[] = [];
  let fallback: VNode | undefined;
  let fallbackPart = 0;
  const seen = new Map<string, number>();

  const add = (key: string, vnode: VNode, part: number): void => {
    if (key === "*") {
      if (fallbackPart !== 0) {
        throw new Error(
          `[Ramonda Router] createRoutes: a second "*" — part ${fallbackPart} already has the catch-all, and part ${part} ` +
            `names another. A table has one; keep it in the app's own part.`,
        );
      }
      fallback = vnode;
      fallbackPart = part;
      return;
    }
    const before = seen.get(key);
    if (before !== undefined) {
      throw new Error(
        `[Ramonda Router] createRoutes: "${key}" is in two parts of this table — part ${before} and part ${part}. ` +
          `The first would always win; keep it in the part that owns it.`,
      );
    }
    seen.set(key, part);
    const { regex, paramNames } = compilePattern(key);
    compiled.push({ key, regex, paramNames, vnode, part });
  };

  parts.forEach((part, index) => {
    if (part === undefined) return;
    const at = index + 1;
    if (isCompiled(part)) {
      for (const route of part.compiled) add(route.key, route.vnode, at);
      if (part.fallback !== undefined) add("*", part.fallback, at);
      return;
    }
    for (const [key, vnode] of Object.entries(part)) add(key, vnode, at);
  });

  // A route an earlier one matches first is never reached. Compared segment by segment, never by
  // trying a sample value — found by review, `/x/a` claimed to hide `/:p/a`, which `/y/a` reaches —
  // and only against earlier routes that COULD hide it: the same number of segments, and a first
  // segment that is the same or a param. Every route against every earlier one took 293 ms for 3000
  // routes, at module load, in production.
  // Indexed so a route is tried only against earlier routes that could hide it: the same number of
  // segments and, at the later route's first fixed segment, the same text or a param. Every route
  // against every earlier one was 293 ms for 3000 routes, and a table where every route starts with
  // `/:lang` was 811 ms — at module load, in production.
  const bySegment = new Map<string, CompiledRoute[]>();
  const paramAt = new Map<string, CompiledRoute[]>();
  const sameLength = new Map<number, CompiledRoute[]>();
  const into = (map: Map<string, CompiledRoute[]>, key: string, route: CompiledRoute) => {
    const list = map.get(key);
    if (list) list.push(route);
    else map.set(key, [route]);
  };
  for (const route of compiled) {
    const segments = route.key.split("/");
    const fixed = segments.findIndex((segment, at) => at > 0 && !segment.includes(":"));
    const candidates =
      fixed === -1
        ? (sameLength.get(segments.length) ?? [])
        : [
            ...(bySegment.get(`${segments.length}|${fixed}|${segments[fixed]}`) ?? []),
            ...(paramAt.get(`${segments.length}|${fixed}`) ?? []),
          ];
    const hidden = candidates.find((one) => hides(one.key, route.key));
    if (hidden !== undefined) {
      throw new Error(
        `[Ramonda Router] createRoutes: "${route.key}" can never be reached: "${hidden.key}", before it, matches it ` +
          `first. Put "${route.key}" before "${hidden.key}".`,
      );
    }
    segments.forEach((segment, at) => {
      if (at === 0) return;
      into(
        segment.includes(":") ? paramAt : bySegment,
        segment.includes(":") ? `${segments.length}|${at}` : `${segments.length}|${at}|${segment}`,
        route,
      );
    });
    const list = sameLength.get(segments.length);
    if (list) list.push(route);
    else sameLength.set(segments.length, [route]);
  }

  return {
    compiled: compiled.map((route) => ({
      key: route.key,
      regex: route.regex,
      paramNames: route.paramNames,
      vnode: route.vnode,
    })),
    fallback,
  };
}

/** A segment that is one `:param` and nothing else — it matches any one segment `[\w-]+` can. */
const WHOLE_PARAM = /^:\w+$/;

/**
 * Whether `earlier` matches every path `later` does. Segment by segment: a whole-param segment takes
 * any segment its `[\w-]+` can (a param of the later route, or a literal of those characters); any
 * other segment must be written the same. Both are anchored, so the counts must agree.
 */
function hides(earlier: string, later: string): boolean {
  const a = earlier.split("/");
  const b = later.split("/");
  if (a.length !== b.length) return false;
  return a.every((segment, at) => {
    const other = b[at];
    // A whole param takes any segment of `[\w-]` — a later param's values are of those too, so a
    // segment like `file-:id` is all of them. Found by review: it was only matched as written.
    if (WHOLE_PARAM.test(segment)) return /^[\w-]+$/.test(other.replace(/:\w+/g, "x"));
    // A param inside a segment — `:name.json` — matches what the router's own regex for it matches.
    // Found by review: compared as text, `/files/:name.json` did not hide `/files/a.json`.
    if (segment.includes(":") && !other.includes(":")) return segmentPattern(segment).test(other);
    return segment === other;
  });
}

/** One segment as the router matches it: each `:param` is `[\w-]+`, everything else literal. */
function segmentPattern(segment: string): RegExp {
  const parts = segment.split(/:\w+/).map((literal) => literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^${parts.join("[\\w-]+")}$`);
}

/** A part that is already a compiled table — a module's — rather than a literal one. */
function isCompiled(part: RouteConfig<string> | Record<string, VNode>): part is RouteConfig<string> {
  return Array.isArray((part as RouteConfig<string>).compiled);
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
