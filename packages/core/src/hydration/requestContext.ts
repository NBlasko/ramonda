import { diagnose } from "../debug/diagnostics";

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
  /** Whether the server sends this value to the browser. Default false — see `requestKey`. */
  readonly exposeToClient: boolean;
  /** Phantom, for inference only — never set. */
  readonly __type?: T;
}

export interface RequestKeyOptions {
  /**
   * Send this value to the browser with the page, so `requestContext().get(key)` returns it on
   * the client too.
   *
   * **Default false, and that default is the point.** Anything exposed is published: it sits in
   * the HTML for anyone to read. Opt in only for what is safe to publish — a display name, an id,
   * a role — never a session token, a raw cookie, or a database record. Cookies and headers can
   * never be exposed at all.
   *
   * You often need none of this: reading the request in `@create` and keeping the result in
   * `@state` already travels, because `@state` is serialized and `@create` is skipped on
   * hydration. Expose a key when a value has to be readable from `requestContext()` itself on
   * the client — typically because several components read it directly.
   */
  exposeToClient?: boolean;
}

/**
 * Labels declared with `exposeToClient`. Module-level because key declarations are static (module
 * scope, like a `@state` field's name), not per-request — so this registry says nothing about any
 * one visitor and cannot leak across concurrent requests. The serializer consults it to decide
 * what may travel.
 */
const exposedLabels = new Set<string>();

export function requestKey<T>(label: string, options: RequestKeyOptions = {}): RequestKey<T> {
  const exposeToClient = options.exposeToClient === true;
  if (exposeToClient) exposedLabels.add(label);
  return { label, exposeToClient };
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
 * The values a render may send to the browser: the seeded ones whose key opted in with
 * `exposeToClient`. Everything else — cookies, headers, un-opted values — stays on the server.
 * Returns `undefined` when there is nothing to send, so the page carries no blob at all.
 */
export function collectExposedRequest(scope: RequestScope | undefined): Record<string, unknown> | undefined {
  if (!scope) return undefined;
  let out: Record<string, unknown> | undefined;
  for (const [label, value] of scope.values) {
    if (!exposedLabels.has(label)) continue;
    (out ??= {})[label] = value;
  }
  return out;
}

/**
 * Installs the browser's request scope from what the server exposed — called once by
 * `hydrateRoot`/`bootstrap` and then left in place, because a browser page IS one request.
 *
 * Unlike the server's scope this is not cleared after the render: a component that re-renders
 * later (a state change, a client navigation) must still be able to read it rather than throw.
 * There is no concurrency to worry about — one page, one request.
 */
export function installClientRequestScope(values: Record<string, unknown> | undefined): void {
  current = {
    mode: "client",
    // Replaced on read in client mode (see `requestContext`), so a client navigation does not
    // leave a stale URL behind. This is only the seed.
    url: new URL(typeof location === "undefined" ? "http://localhost/" : location.href),
    cookies: new Map(),
    headers: new Headers(),
    values: new Map(Object.entries(values ?? {})),
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
      "[Ramonda] requestContext() was called outside a render. It is available while a page is " +
        "being rendered on the server or at build, and in the browser after `hydrateRoot`/" +
        "`bootstrap` has started the app — not at module top level.",
    );
  }
  return current;
}

/**
 * In the browser, per-request data the server did not expose is simply not here. Report it (a
 * development build only) and return nothing, rather than throwing: breaking the page is the
 * worse outcome, and if the server rendered a value where this read is, hydration already
 * reports the divergence too. See RMD025.
 */
function reportClientRead(field: string): void {
  if (__DEV__) {
    diagnose("RMD025", field, `\`requestContext().${field}\` was read in the browser.`);
  }
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
      const scope = requireScope();
      // Read live in the browser, so a client navigation does not leave a stale URL behind.
      if (scope.mode === "client" && typeof location !== "undefined") return new URL(location.href);
      return scope.url;
    },
    get cookies(): RequestCookies {
      return {
        get(name: string): string | undefined {
          guardBuild(`cookies.get("${name}")`);
          const scope = requireScope();
          // Never exposed: a cookie is the server's, and an httpOnly one is invisible to JS anyway.
          if (scope.mode === "client") {
            reportClientRead(`cookies.get("${name}")`);
            return undefined;
          }
          return scope.cookies.get(name);
        },
        has(name: string): boolean {
          guardBuild(`cookies.has("${name}")`);
          const scope = requireScope();
          if (scope.mode === "client") {
            reportClientRead(`cookies.has("${name}")`);
            return false;
          }
          return scope.cookies.has(name);
        },
      };
    },
    get headers(): Headers {
      guardBuild("headers");
      const scope = requireScope();
      if (scope.mode === "client") {
        reportClientRead("headers");
        return new Headers();
      }
      return scope.headers;
    },
    get<T>(key: RequestKey<T>): T {
      guardBuild(`get("${key.label}")`);
      const scope = requireScope();
      if (scope.mode === "client" && !scope.values.has(key.label)) {
        // Either the key never opted into `exposeToClient`, or the server never seeded it.
        reportClientRead(`get("${key.label}")`);
        return undefined as T;
      }
      return scope.values.get(key.label) as T;
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
