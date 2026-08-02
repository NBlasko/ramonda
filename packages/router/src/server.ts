import type { PathOf, RouteConfig } from "./match";

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
 */
export function routePlan<C extends RouteConfig>(server: ServerRoutes<C>): RoutePlan {
  const plan: RoutePlan = { static: [], isr: [], server: [], needsData: [] };

  for (const route of server.routes.compiled) {
    const entry = server.config[route.key] ?? {};
    const hasParams = route.paramNames.length > 0;

    if (entry.revalidate !== undefined) {
      plan.isr.push({ path: route.key, revalidate: entry.revalidate });
      if (hasParams) plan.needsData.push(route.key);
      continue;
    }

    const prerender = entry.prerender ?? server.defaultMode === "static";
    if (prerender) {
      plan.static.push(route.key);
      if (hasParams) plan.needsData.push(route.key);
    } else {
      plan.server.push(route.key);
    }
  }

  return plan;
}
