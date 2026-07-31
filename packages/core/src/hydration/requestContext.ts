/**
 * Per-request data, and the guard that makes prerendering safe.
 *
 * The whole point: per-request data (cookies, headers, the signed-in user) is reachable
 * ONLY through `requestContext()`, so the build can PROVE a route touched none of it before
 * baking it. Reading a per-request field during a static build THROWS — and the build turns
 * that throw into "route /x cannot be prerendered: it read the request." A page that reads
 * the request literally cannot be baked, so one user's data can never end up in another's
 * cached HTML. That is the one non-negotiable.
 *
 * Three modes, one per render:
 *   - "server"  — a live per-request render. Reads return the real seeded values.
 *   - "build"   — a static prerender. Per-request reads THROW (poisoned). `url` is fine:
 *                 it is the page identity, known per baked path.
 *   - "client"  — in the browser. Reads return only what the server chose to EXPOSE (the
 *                 safe subset restored from the page), never secrets.
 *
 * Modeled on `renderEnv` / `serverWork`: a module-level scope set around the synchronous
 * root mount. On the server, module scope is shared by concurrent requests, so nothing may
 * read this across an `await` off the module flag alone — the render sets it, mounts, and
 * clears it before its first await. (Async reads inside a loader will inherit the scope the
 * same way `serverWork` does, once loaders are wired in — see the SSG/SSR design.)
 */

export type RequestMode = "server" | "build" | "client";

/** A typed, per-request slot. Declare once at module scope; the server seeds it, the tree reads it. */
export interface RequestKey<T> {
  readonly label: string;
  /** Phantom, for inference only — never set. */
  readonly __type?: T;
}

export function requestKey<T>(label: string): RequestKey<T> {
  return { label };
}

/** Read-only cookies. `get`/`has` THROW during a static build (they are per-request). */
export interface RequestCookies {
  get(name: string): string | undefined;
  has(name: string): boolean;
}

/**
 * The per-request surface. `url` is always safe; everything else is per-request and throws
 * during a static build, which is exactly what marks the route un-bakeable.
 */
export interface RequestContext {
  readonly url: URL;
  readonly cookies: RequestCookies;
  readonly headers: Headers;
  get<T>(key: RequestKey<T>): T;
}

interface RequestScope {
  mode: RequestMode;
  url: URL;
  cookies: Map<string, string>;
  headers: Headers;
  values: Map<string, unknown>;
  /**
   * In "build" mode: the first per-request field that was read, or `undefined` if none.
   * Recorded IN ADDITION to throwing, because a read inside an async `@mount` throws into the
   * drain's `allSettled` (or `errorHandler`) and is swallowed — the record survives that, so
   * the build can still tell the route read the request. Read by `renderStatic`.
   */
  read?: string;
}

/** The field a build-mode render read from the request, if any — see `RequestScope.read`. */
export function getBuildRead(scope: RequestScope | undefined): string | undefined {
  return scope?.read;
}

let current: RequestScope | undefined;

export function getRequestScope(): RequestScope | undefined {
  return current;
}

export function setRequestScope(scope: RequestScope | undefined): void {
  current = scope;
}

export interface RequestScopeInit {
  mode: RequestMode;
  url: URL;
  cookies?: Map<string, string>;
  headers?: Headers;
  values?: Map<string, unknown>;
}

export function createRequestScope(init: RequestScopeInit): RequestScope {
  return {
    mode: init.mode,
    url: init.url,
    cookies: init.cookies ?? new Map(),
    headers: init.headers ?? new Headers(),
    values: init.values ?? new Map(),
  };
}

/**
 * Thrown when per-request data is read during a static build. The build catches it and turns
 * it into a "cannot prerender" error naming the route; uncaught, it means someone read the
 * request somewhere the build did not expect, which is a real bug to surface. `field` is what
 * was read (`cookies.get("session")`, `headers`, `get("currentUser")`) so the message can be
 * precise.
 */
export class RequestReadDuringBuild extends Error {
  readonly field: string;
  constructor(field: string) {
    super(
      `[Ramonda] The request (${field}) was read during a static build, so this route cannot be ` +
        `prerendered — a baked page must not contain per-request data. Remove the read, or render ` +
        `this route per request (do not mark it prerender).`,
    );
    this.name = "RequestReadDuringBuild";
    this.field = field;
  }
}

function requireScope(): RequestScope {
  if (!current) {
    throw new Error(
      "[Ramonda] requestContext() was called outside a render. It is only available while a page " +
        "is being rendered (server, build, or client hydration).",
    );
  }
  return current;
}

/**
 * The poison that proves safety: during a static build, reading a per-request field is RECORDED
 * on the scope (survives an async throw being swallowed) and then throws (fails a sync caller
 * fast). `renderStatic` consults the record afterwards, so either path blocks the prerender.
 */
function guardBuild(field: string): void {
  if (current?.mode === "build") {
    if (current.read === undefined) current.read = field;
    throw new RequestReadDuringBuild(field);
  }
}

/**
 * Reads the current request's context. `url` is always safe; `cookies`, `headers` and
 * `get(key)` return real values on the server, the exposed subset on the client, and THROW
 * during a static build.
 */
export function requestContext(): RequestContext {
  return {
    get url(): URL {
      return requireScope().url;
    },
    get cookies(): RequestCookies {
      return {
        get(name: string): string | undefined {
          guardBuild(`cookies.get("${name}")`);
          return requireScope().cookies.get(name);
        },
        has(name: string): boolean {
          guardBuild(`cookies.has("${name}")`);
          return requireScope().cookies.has(name);
        },
      };
    },
    get headers(): Headers {
      guardBuild("headers");
      return requireScope().headers;
    },
    get<T>(key: RequestKey<T>): T {
      guardBuild(`get("${key.label}")`);
      return requireScope().values.get(key.label) as T;
    },
  };
}

/**
 * SERVER-ONLY in spirit: seeds a per-request value for the current render, before the tree
 * reads it. The app's server (or a middleware) validates the session and seeds the user here;
 * components then read it via `requestContext().get(key)`. There is no build-time counterpart
 * — a value that exists per request cannot exist at build.
 */
export function seedRequest<T>(key: RequestKey<T>, value: T): void {
  requireScope().values.set(key.label, value);
}
