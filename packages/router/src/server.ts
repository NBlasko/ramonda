import { matchParams, type PathOf, type RouteConfig } from "./match";

/**
 * The ISR cache lives next door and is re-exported here, so a server file has ONE import:
 * `defineServer` and `routePlan` say how each route renders, `createIsrCache` and a store say
 * where the cached ones are kept. See isr.ts.
 */
export {
  createIsrCache,
  fileStore,
  memoryStore,
  type FileStoreOptions,
  type IsrCache,
  type IsrCacheOptions,
  type IsrEntry,
  type IsrMode,
  type IsrPage,
  type IsrStore,
} from "./isr";

/**
 * SERVER-ONLY router config — `@ramonda/router/server`.
 *
 * This is Layer B: it attaches rendering modes (and, later, loaders) to the routes declared
 * in the shared table, keyed by path. It must NEVER reach the client bundle — a client build
 * that imports it gets the throwing stub (`server.browser.ts`, wired via the `browser` export
 * condition), and `defineServer` throws at runtime in a browser too. The bundle boundary is a
 * directory in your app (`server/`), not magic here.
 *
 * The config is EXHAUSTIVE: every path in the table must have an entry, so adding a route to
 * `createRoutes` fails this until you handle it here, and an entry for a non-route is an error.
 * One source of truth, enforced by the type — the two files cannot drift.
 */

/** How one route renders. A bare `{}` means "follow `defaultMode`". */
export interface ServerRoute {
  /**
   * Prerender at build. `true` opts in; `false` opts OUT when `defaultMode` is `"static"`.
   * Omitted → follows `defaultMode`. A prerendered route that reads the request at build is a
   * BUILD ERROR (it cannot be static — that would leak per-request data).
   */
  prerender?: boolean;
  /** ISR: prerender, then rebake in the background every N seconds (still no per-request data). */
  revalidate?: number;
}

/** Exhaustive per-route config: every navigable path in the table must appear. */
export type ServerConfig<C extends RouteConfig> = {
  [P in PathOf<C>]: ServerRoute;
};

export interface ServerOptions {
  /**
   * What a route with no explicit mode does. Framework default `"server"` (safe — nothing
   * bakes unless asked). A static-heavy project sets `"static"` once and opts its few dynamic
   * routes out with `prerender: false`.
   */
  defaultMode?: "static" | "server";
}

/** The result of `defineServer` — the table, its per-route config, and the default mode. */
export interface ServerRoutes<C extends RouteConfig = RouteConfig> {
  readonly routes: C;
  readonly config: Record<string, ServerRoute>;
  readonly defaultMode: "static" | "server";
}

/** True when evaluated outside a Node process — i.e. in a browser. SSR under jsdom still has a
 * Node process, so this stays false there; only a real client bundle trips it. (Read through
 * `globalThis` so the router's own tsconfig needs no Node types.) */
function isBrowser(): boolean {
  const proc = (globalThis as { process?: { versions?: { node?: unknown } } }).process;
  return proc?.versions?.node === undefined;
}

/**
 * Attaches server-only rendering config to a route table. Throws immediately if it is ever
 * evaluated in a browser — server config, loaders, and anything they reach (DB clients, secrets)
 * must not run on the client. See the `browser` export stub for the build-time counterpart.
 */
export function defineServer<C extends RouteConfig>(
  routes: C,
  config: ServerConfig<C>,
  options: ServerOptions = {},
): ServerRoutes<C> {
  if (isBrowser()) {
    throw new Error(
      "[Ramonda Router] defineServer() ran in a browser. Server route config (modes, loaders, and " +
        "anything they touch) must stay on the server — keep it under your app's `server/` folder and " +
        "never import it from client code.",
    );
  }
  return {
    routes,
    config: config as Record<string, ServerRoute>,
    defaultMode: options.defaultMode ?? "server",
  };
}

/** Every path a build should render, partitioned by how. See `routePlan`. */
export interface RoutePlan {
  /** Prerender at build, served static. */
  static: string[];
  /** Prerender + revalidate in the background. */
  isr: Array<{ path: string; revalidate: number }>;
  /** Rendered per request (the default). */
  server: string[];
  /** `:param` patterns that are static/isr but need concrete paths supplied to bake. */
  needsData: string[];
}

/**
 * Partitions a server config by rendering mode — the vocabulary the build and the prod server
 * share. It reports what is knowable from the DECLARED modes; a route that turns out to read the
 * request at build is discovered later, when the build renders it under a poisoned request
 * context and the guard throws (that refines `static` → `server`). So this is the plan; the
 * build is the authority.
 *
 * ## `static` holds PATHS, never patterns — and it used to hold both
 *
 * `/players/:id` is one route and however many players there are. It went into `static` as itself,
 * and a build loop that bakes what it is given wrote **`dist/static/players/:id/index.html`** — a
 * directory literally named `:id`, a page nobody can reach, and nothing said a word. The sibling in
 * `match.ts` had this right from the start: `routePaths` puts a parameterised route in `needsData`
 * and keeps it out of `paths`.
 *
 * So pass the concrete paths, and this fills them in:
 *
 * ```ts
 * const plan = routePlan(server, players.map((p) => `/players/${p.id}`));
 * // plan.static → ["/", "/signup", "/players/7", "/players/9"]
 * ```
 *
 * **With none supplied it THROWS**, rather than skipping the route or falling it back to the server.
 * A config that says `prerender` and a build that quietly does not is the shape where the site ships
 * missing half its pages and every page it did emit looks perfectly correct — the same argument
 * `renderStatic`'s `blockedBy` already settles by stopping the build.
 *
 * **ISR is not held to it, and for a reason rather than as an omission.** A `revalidate` route with a
 * `:param` bakes nothing at build: `createIsrCache` matches the pattern and fills as pages are asked
 * for, each under its own path, bounded by its `maxPages`. So there is no list for a build to be given,
 * and the pattern stays in `plan.isr` as the rule it is.
 *
 * `paths` are for PRERENDERING, so a path belonging to an ISR route is refused by the check below like
 * any other path that bakes nothing — warming an ISR page is `isr.serve(path)` at boot, not a build
 * step. It is still named in `needsData` so a caller doing that knows which routes have pages to warm.
 *
 * (Two earlier versions of this comment were wrong in two different directions, which is worth leaving
 * a note about: the first claimed such a route "is served and refreshed per request" and that a build
 * could "warm those pages"; the second described the gap that the same branch then closed. A comment
 * about another module ages the moment that module changes.)
 *
 * @param paths concrete paths for the parameterised routes marked for prerender
 */
export function routePlan<C extends RouteConfig>(server: ServerRoutes<C>, paths: readonly string[] = []): RoutePlan {
  const plan: RoutePlan = { static: [], isr: [], server: [], needsData: [] };
  // A supplied path can satisfy two patterns — `/users/7` fills `/users/:id` and `/:page` alike — and
  // the file it bakes is the same file either way, so the list is deduped rather than the match
  // narrowed. Ordered, because a build's log reads better in the order the table declares.
  const baked = new Set<string>();

  for (const route of server.routes.compiled) {
    const entry = server.config[route.key] ?? {};
    const hasParams = route.paramNames.length > 0;

    if (entry.revalidate !== undefined) {
      plan.isr.push({ path: route.key, revalidate: entry.revalidate });
      if (hasParams) plan.needsData.push(route.key);
      continue;
    }

    const prerender = entry.prerender ?? server.defaultMode === "static";
    if (!prerender) {
      plan.server.push(route.key);
      continue;
    }

    if (!hasParams) {
      baked.add(route.key);
      continue;
    }

    plan.needsData.push(route.key);
    const filled = paths.filter((path) => matchParams(path, route.key) !== null);
    if (filled.length === 0) {
      const takes = route.paramNames.map((name) => `:${name}`).join(", ");
      const example = `routePlan(server, items.map((item) => \`${route.key.replace(/:(\w+)/g, "${item.$1}")}\`))`;
      // Two different faults, and the same sentence for both sent a reader to add an argument that was
      // already there. Found by review.
      throw new Error(
        paths.length === 0
          ? `[Ramonda] \`${route.key}\` is marked for prerender and takes ${takes}, so a build cannot ` +
              `know which pages exist. Pass them: ${example}. Or drop \`prerender\` and let it render per request.`
          : `[Ramonda] \`${route.key}\` is marked for prerender and takes ${takes}, and none of the ` +
              `${paths.length} path(s) given match it — check their shape rather than adding more. A param ` +
              `matches one segment of word characters and dashes, so a trailing slash, a dot or an ` +
              `encoded character falls outside it. Given: ${paths.slice(0, 3).join(", ")}${paths.length > 3 ? ", …" : ""}`,
      );
    }
    for (const path of filled) baked.add(path);
  }

  /**
   * Every path GIVEN has to be baked, and this is the half the first version left open.
   *
   * `filled` only refused a route that matched NOTHING. Hand it `["/guide/ok", "/guide/v1.2"]` and the
   * first matches, so the throw above stays quiet and the second is dropped without a word — measured,
   * and it is the very failure the throw exists to prevent: a site missing pages while every page it
   * did emit looks perfectly correct. A param matches `[\w-]+`, one segment, so a trailing slash, a
   * dot, a percent-encoded character or a typo'd prefix all fall out that way.
   *
   * Checked against what was actually baked rather than per route, because a path may legitimately be
   * claimed by any of several patterns.
   */
  const unused = paths.filter((path) => !baked.has(path));
  if (unused.length > 0) {
    throw new Error(
      `[Ramonda] ${unused.length} path(s) given to routePlan match no prerendered route, so they would ` +
        `never be baked: ${unused.join(", ")}. A \`:param\` matches one segment of word characters and ` +
        `dashes — a trailing slash, a dot or an encoded character is outside it — and a path for a route ` +
        `that is not marked \`prerender\` has nothing to bake either.`,
    );
  }

  plan.static = [...baked];
  return plan;
}
