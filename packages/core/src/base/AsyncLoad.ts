import { Component } from "..";
import type { RamondaNode } from "../types/vdom";
import { createRamonda } from "../vdom/CreateRamonda";
import { mount, destroy, state, create, deferHydration, watchProp } from "./decorators";
import { addModulePreload } from "./Head";

export type Lazy = () => Promise<any>;

/** What `errorFallback` receives when it is a function. */
export interface AsyncLoadFailure {
  /** Whatever the import rejected with, or the error AsyncLoad threw itself. */
  error: unknown;
  /** Clears the error and loads again. Safe to call more than once. */
  retry: () => void;
  /** 1 on the first failure, 2 after the first retry, and so on. */
  attempt: number;
}

export interface AsyncLoadProps {
  lazy: Lazy;
  /**
   * Rendered when the load fails. Give a function to get a `retry` handler:
   *
   *   errorFallback: ({ error, retry }) => (
   *     <div>Failed. <button onClick={retry}>Try again</button></div>
   *   )
   *
   * Shaped like `ErrorBoundary`'s `fallback` on purpose — one shape to learn
   * for the same job. A plain node still works when there is nothing to offer.
   */
  errorFallback: RamondaNode | ((failure: AsyncLoadFailure) => RamondaNode);
  onLoading: RamondaNode;
  namedExport?: string;
  loadedProps?: unknown;
  onCreate?: () => void;
  /**
   * Identifies the module in the process-wide cache. Defaults to the source of
   * `lazy`, which is right for the usual `() => import('./Thing')`.
   *
   * Pass it when two different modules are loaded by lazies with **identical
   * source** — a factory that builds them, for instance. Two such functions
   * stringify the same, so they would share one cache entry and the second
   * would render the first one's module.
   */
  cacheKey?: string;
  /**
   * The URL(s) of the chunk this lazy resolves to on the CLIENT, so a server
   * render can emit `<link rel="modulepreload">` for them.
   *
   * ## What it buys, and what it does not
   *
   * It does **not** remove the request — the browser still fetches the chunk. It
   * removes the **waterfall**: without a hint the chunk cannot even be requested
   * until the main bundle has downloaded, parsed, hydrated far enough to reach
   * this component, and called `lazy()`. With one, the browser starts fetching it
   * from the moment it parses `<head>`, in parallel with everything else.
   *
   * On a prerendered page that is the difference between "interactive shortly
   * after paint" and "interactive after two sequential round trips" — the content
   * itself is already on screen either way, because the server rendered it.
   *
   * ## Why you have to supply it
   *
   * The server resolves `() => import("./Panel")` to a module in ITS module
   * graph; the client fetches `/assets/chunk-A1B2C3.js`. Nothing at runtime knows
   * that mapping — only the bundler does, and only after it has hashed the
   * output. So the value comes from your build's manifest: esbuild's
   * `--metafile`, Vite's `manifest.json`, whatever your bundler emits.
   *
   * Ignored on the client, where the import is already in flight and a hint
   * would arrive too late to do anything.
   */
  preload?: string | readonly string[];
}

/**
 * Process-wide, on purpose: a module loaded once should not be fetched again by
 * a second component. It is NOT part of the app's state, which is exactly why
 * `render` reads it rather than trusting `isFetched` — see below.
 */
const cachedFiles = new Map<string, LoadedComponent>();

type LoadedComponent = ((loadedProps?: unknown) => RamondaNode) | undefined;

/**
 * Loads a module the first time it is rendered, showing `onLoading` until it
 * arrives and `errorFallback` if it never does.
 *
 * ```tsx
 * <AsyncLoad
 *   lazy={() => import("./HeavyChart")}
 *   onLoading={<p>Loading…</p>}
 *   errorFallback={<p>Could not load the chart.</p>}
 *   loadedProps={{ points }}
 * />
 * ```
 *
 * An ordinary class component with the default `<ramonda-host>`, so it is
 * exactly one element like every other tag. The loaded module renders INSIDE
 * that host, and its own props are passed as `loadedProps` rather than being
 * mixed into this tag's attributes — those two sets of props belong to different
 * components and must not share a namespace.
 *
 * `errorFallback` may be a function, and then it receives `{ error, retry,
 * attempt }` — the same shape as `ErrorBoundary`'s fallback. There is no
 * automatic retry; see `retry` for why.
 *
 * **No `key` is injected.** An earlier version used the source of `lazy` as the
 * vnode key to keep identity stable, which gave two `AsyncLoad`s sharing one
 * `lazy` the SAME key — duplicate keys among siblings (RMD002), and a diff that
 * could hand one's DOM node to the other. The module cache and reconciliation
 * identity are different things; `cacheKey` is now the one, and `key` is yours
 * to pass if you want the other.
 */
export class AsyncLoad extends Component<AsyncLoadProps> {
  /**
   * A GETTER, not a field initialized once.
   *
   * It used to be `private readonly cacheKey = …`, computed at construction — so
   * a component whose `lazy` prop CHANGED kept the first one's key forever. The
   * failure is precise and quiet: `render` reads the cache under the stale key
   * and serves the OLD module, while nothing refetches because `@mount` already
   * ran. Measured in a route outlet — the URL changed, the title changed, and the
   * content stayed on the previous page with no request made.
   *
   * Only ever right with a fixed `lazy`, which is how it was always used until a
   * router pointed one at a different module per route.
   */
  private get cacheKey(): string {
    return this.props.cacheKey ?? this.props.lazy.toString();
  }
  /**
   * Only a re-render trigger. Whether the module is available is decided by the
   * cache, never by this counter: state is restored across a server/client
   * boundary and the cache is not, so a hydrating client can be told "fetched"
   * while its own cache is empty.
   *
   * **A counter rather than a boolean, and that is the whole point.** As a
   * boolean it was restored from the server as `true`, so when the client's own
   * load finished and set it to `true` again the signal saw no change, scheduled
   * no render, and the page stayed on the loading fallback **forever** — the
   * module sitting in the cache, unused. Measured: `"loading…"` still on screen
   * long after the import resolved.
   *
   * An increment always differs from what was restored, so the render that
   * finally reads the cache actually happens.
   */
  @state loadCount = cachedFiles.has(this.props.cacheKey ?? this.props.lazy.toString()) ? 1 : 0;
  @state hasError = false;
  /** Bumped by `retry`, so the fallback can tell a first failure from a fifth. */
  @state attempt = 0;
  /**
   * The failure itself. NOT `@state`: state is serialized into the hydration
   * blob, and an Error does not survive JSON. `hasError` is the trigger; this is
   * only read during the render that follows it.
   */
  private failure: unknown;
  /** The promise outlives the component; without this it writes to a dead one. */
  private disposed = false;
  /** Guards a retry pressed while a load is already running. */
  private loading = false;

  /**
   * Emitted during the server render, so the hint is in `<head>` before the
   * browser has parsed a line of the main bundle.
   *
   * `env: "server"` rather than shared: on the client this component's own
   * `lazy()` is already running by the time anything here could execute, so a
   * preload link would be a duplicate request hint for a request in flight.
   */
  @create({ env: "server" })
  emitPreloadHints() {
    const preload = this.props.preload;
    if (!preload) return;

    if (typeof preload === "string") addModulePreload(preload);
    else for (const href of preload) addModulePreload(href);
  }

  /**
   * The `lazy` changed — a different module is wanted now.
   *
   * Resets the failure state and loads again. `@watchProp` rather than an
   * `@effect` because it runs BEFORE the render, so the render that follows a
   * route change already reads the right cache key instead of showing the old
   * module for one frame.
   */
  @watchProp((props: AsyncLoadProps) => props.cacheKey ?? props.lazy.toString())
  onSourceChanged() {
    this.loading = false;
    this.hasError = false;
    this.failure = undefined;
    void this.load();
  }

  @mount afterCreate() {
    this.props.onCreate?.();
    // Returned so a server render can await it — see docs/async-ssr-proposal.md.
    return this.load();
  }

  /**
   * Keeps the server's markup instead of replacing it with `onLoading`.
   *
   * The server awaited the import and rendered the real component into the HTML.
   * A hydrating client's module cache is cold, so its first render would produce
   * the loading fallback — a structure mismatch, which hydration resolves by
   * DESTROYING the server's content. The reader watches finished content
   * collapse into a spinner and then reappear.
   *
   * Deferring inverts that: the content stays, and becomes interactive when the
   * chunk lands.
   *
   * `undefined` when the module is already cached — a second instance of the same
   * chunk, a warm navigation — because then the first render is already correct
   * and waiting would cost a delay for nothing.
   */
  @deferHydration
  waitForChunk() {
    if (cachedFiles.has(this.cacheKey)) return undefined;
    return this.load();
  }

  private load(): Promise<unknown> {
    if (this.loading) return Promise.resolve();

    // The CACHE decides, not `isFetched`. After hydration the flag can be true
    // with nothing behind it, and trusting it there left the page stuck on the
    // loading fallback forever.
    if (cachedFiles.has(this.cacheKey)) {
      this.loadCount = this.loadCount + 1;
      return Promise.resolve();
    }

    this.loading = true;
    return this.props
      .lazy()
      .then((res) => {
        const namedExport = this.props.namedExport ?? "default";

        if (!res[namedExport]) throw new Error(`Missing named export: ${namedExport}`);

        const component = res[namedExport];
        // A class is wrapped into the one callable shape the cache holds, so
        // `render` has a single thing to call whatever the module exported.
        // This is `createTemplate` inlined — it was the helper's last real use,
        // and one arrow here is cheaper than a public API for it.
        const loadedComponent: LoadedComponent = component.__isComponent
          ? (loadedProps?: unknown) => createRamonda(component, (loadedProps ?? {}) as Record<string, unknown>)
          : component;

        // Cache even if this component is gone: the next one to ask for the
        // same module should not have to fetch it again.
        cachedFiles.set(this.cacheKey, loadedComponent);
        this.loading = false;
        if (this.disposed) return;
        this.loadCount = this.loadCount + 1;
      })
      .catch((e) => {
        console.error(e);
        this.loading = false;
        if (this.disposed) return;
        this.failure = e;
        this.hasError = true;
      });
  }

  /**
   * Clears the error and loads again. Handed to `errorFallback` when it is a
   * function; there is no automatic retry, because an import fails for reasons
   * that mostly do not recover — a chunk removed by a deploy, a module that
   * throws while evaluating — and repeating those costs requests and re-runs
   * side effects. Whether to offer a retry is the app's call.
   */
  retry() {
    if (this.loading) return;
    this.attempt++;
    this.failure = undefined;
    this.hasError = false;
    this.load();
  }

  @destroy dispose() {
    this.disposed = true;
  }

  public render() {
    const p = this.props;

    // Read the cache, not the flag. A restored `isFetched` with an empty cache
    // used to reach `cachedFiles.get(key)!` and call `undefined(props)` —
    // "loadedComponent is not a function", and the page did not hydrate at all.
    const loadedComponent = cachedFiles.get(this.cacheKey);
    if (loadedComponent) return loadedComponent(p.loadedProps);

    if (this.hasError) {
      const fallback = p.errorFallback;
      // A vnode is never a function (the diff drops functions among children),
      // so this discriminates the two shapes with nothing to configure.
      return typeof fallback === "function"
        ? fallback({
            error: this.failure,
            retry: this.retry,
            attempt: this.attempt + 1,
          })
        : fallback;
    }
    return p.onLoading;
  }
}
