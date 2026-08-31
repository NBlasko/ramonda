import { Component } from "..";
import type { RamondaNode } from "../types/vdom";
import { createRamonda } from "../vdom/CreateRamonda";
import { isComponentClass } from "../vdom/guards";
import { mounted, destroyed, state, created, deferHydration, watchProp } from "./decorators";
import { addModulePreload } from "./Head";
import { diagnose } from "../debug/diagnostics";

export type Lazy = () => Promise<Record<string, unknown>>;

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

/**
 * What each cache entry actually resolved to, and which `lazy` put it there.
 *
 * `cachedFiles` holds the RENDERABLE — a class already wrapped into a callable —
 * so it cannot be compared with what a second `lazy` resolves. The raw export is
 * kept beside it for exactly that comparison, and the owner is what says a
 * comparison is worth making at all.
 */
const cachedExports = new Map<string, unknown>();
const cacheOwners = new Map<string, unknown>();
/**
 * The minted collision key a MODULE already holds, so a `lazy` rebuilt per render
 * that collides on the same source reuses it instead of minting a fresh key (and
 * three strong cache entries) for the same module every time. Bounded by the number
 * of distinct collided modules, which is finite.
 */
const mintedByComponent = new Map<unknown, string>();

/** Test-only: how many entries the module cache holds. Not re-exported from `index`. */
export function __lazyCacheSize(): number {
  return cachedFiles.size;
}

/**
 * A key of its own for a `lazy` PROVEN to load something other than what is cached
 * under its derived key — see `verifyAgainstCache`.
 *
 * Keyed by the function and weak, so a lazy built per render is collected with
 * everything it closed over rather than held here for the life of the page.
 */
const ownKeys = new WeakMap<object, string>();
/** Functions already compared against the entry they hit — checked once, not per mount. */
const compared = new WeakSet<object>();
let minted = 0;

/**
 * The cache key for a set of props.
 *
 * Derived from the SOURCE of `lazy`, which is right whenever that source names the
 * module it loads: `() => import("./Thing")` written in two components is two
 * different function objects with one meaning, and they SHOULD share what they
 * load. It is also what makes the key survive JSX rebuilding its arrow on every
 * render.
 *
 * `ownKeys` is the exception, and it is only ever filled in by observation — see
 * `verifyAgainstCache`. Nothing here guesses from the text of the function.
 *
 * A module function rather than only a getter because `@watchProp` watches this
 * too: watching a key computed one way while reading one computed another is how a
 * component reloads when nothing changed, or holds still when everything did.
 */
function cacheKeyFor(props: AsyncLoadProps): string {
  const explicit = props.cacheKey;
  if (explicit !== undefined) return explicit;
  return ownKeys.get(props.lazy) ?? props.lazy.toString();
}

/**
 * The one callable shape the cache holds, whatever the module exported.
 *
 * A class is wrapped so `render` has a single thing to call. This is
 * `createTemplate` inlined — it was the helper's last real use, and one arrow here
 * is cheaper than a public API for it.
 */
function toRenderable(component: unknown): LoadedComponent {
  return isComponentClass(component)
    ? (loadedProps?: unknown) => createRamonda(component, (loadedProps ?? {}) as Record<string, unknown>)
    : (component as LoadedComponent);
}

/**
 * Files a loaded module under a key that belongs to it, and reports if that meant
 * taking a new one.
 *
 * `key` already has an entry, filled by a DIFFERENT `lazy`, holding a DIFFERENT
 * module: two functions with one source that load different things, proven rather
 * than guessed. Whichever finished second used to overwrite the first, and then
 * both rendered whatever the last write left — so the two `<AsyncLoad>`s showed the
 * same module and it was a race which one.
 *
 * The newcomer takes a key of its own instead. `explicit` is the app's own claim
 * about identity, so it is believed: two entries deliberately given one `cacheKey`
 * are meant to share it.
 */
function claim(key: string, lazy: unknown, component: unknown, explicit: boolean): string {
  const owner = cacheOwners.get(key);
  const collides = !explicit && owner !== undefined && owner !== lazy && cachedExports.get(key) !== component;

  // On collision, reuse the key this MODULE already minted rather than taking a new
  // one: a factory rebuilds its `lazy` per render, so without this the same module
  // reached through many fresh functions would mint a fresh key — and three strong
  // cache entries — on every render, without bound.
  let target = key;
  if (collides) {
    target = mintedByComponent.get(component) ?? `ramonda-lazy-${++minted}`;
    mintedByComponent.set(component, target);
    ownKeys.set(lazy as object, target);
    if (__DEV__) {
      diagnose(
        "RMD049",
        `asyncLoad:${key}`,
        "Two `lazy` functions have the same source and load different modules, so the cache key derived from that source cannot tell them apart.",
      );
    }
  }

  cachedFiles.set(target, toRenderable(component));
  cachedExports.set(target, component);
  cacheOwners.set(target, lazy);
  return target;
}

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
 * An ordinary class component. Once the module has loaded it renders that
 * module and nothing around it, so nothing of this tag survives in the DOM. The
 * module's own props are passed as `loadedProps` rather than mixed into this
 * tag's attributes — those two sets of props belong to different components and
 * must not share a namespace.
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
   * and serves the OLD module, while nothing refetches because `@mounted` already
   * ran. Measured in a route outlet — the URL changed, the title changed, and the
   * content stayed on the previous page with no request made.
   *
   * Only ever right with a fixed `lazy`, which is how it was always used until a
   * router pointed one at a different module per route.
   */
  /** See `cacheKeyFor` — the same answer this component's `@watchProp` watches. */
  private get cacheKey(): string {
    return cacheKeyFor(this.props);
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
  @state loadCount = cachedFiles.has(this.cacheKey) ? 1 : 0;
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
  @created({ env: "server" })
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
   * an effect because it runs BEFORE the render, so the render that follows a
   * route change already reads the right cache key instead of showing the old
   * module for one frame.
   */
  @watchProp((props) => cacheKeyFor(props))
  onSourceChanged() {
    this.loading = false;
    this.hasError = false;
    this.failure = undefined;
    void this.load();
  }

  @mounted afterCreate() {
    this.props.onCreate?.();
    // Returned so a server render can await it.
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

  /**
   * Checks that the module already cached under this key is the one THIS `lazy`
   * loads — and if it is not, gives this one a key of its own.
   *
   * The key is derived from the source of `lazy`, which identifies the module
   * whenever the source names it. `const make = (path) => () => import(path)`
   * does not: the specifier is a closed-over value the source never shows, so
   * every module the factory builds stringifies the same. The first loaded and
   * cached; the second found a hit and rendered THE FIRST ONE'S MODULE. Nothing
   * failed, nothing was logged, and which module you got depended on which
   * rendered first.
   *
   * Which of the two it is cannot be told from the text of the function — the
   * source a bundler leaves behind is its own business, and a rule guessing at
   * `import("…")` would read one bundler's output correctly and another's
   * backwards. So nothing is guessed: the module is loaded and COMPARED. The
   * module system serves a genuine duplicate from its registry, so the common
   * case pays one resolved promise and confirms the sharing, which is what makes
   * this affordable enough to do in production too — where rendering the wrong
   * module is not a development detail.
   *
   * What the broken case now costs is one frame of the wrong module before the
   * right one replaces it, in exchange for the right one arriving at all.
   *
   * Once per FUNCTION, not once per mount: a second `<AsyncLoad>` given the same
   * proven-different lazy reads its key straight off `ownKeys`.
   */
  private verifyAgainstCache(): void {
    const lazy = this.props.lazy;
    // An explicit `cacheKey` is the app's own claim about identity — believed, not
    // second-guessed. Same for the function that filled the entry in the first place.
    if (this.props.cacheKey !== undefined || compared.has(lazy)) return;

    const key = this.cacheKey;
    const owner = cacheOwners.get(key);
    if (owner === undefined || owner === lazy) return;

    compared.add(lazy);
    void lazy()
      .then((res) => {
        const component = res[this.props.namedExport ?? "default"];
        // The same module: the source named it after all, and sharing is right.
        if (component === cachedExports.get(key) || typeof component !== "function") return;

        claim(key, lazy, component, false);
        if (this.disposed) return;
        this.loadCount = this.loadCount + 1;
      })
      // The cached module renders; a failure to confirm it is not a reason to
      // replace a working page with an error fallback.
      .catch(() => {});
  }

  private load(): Promise<unknown> {
    if (this.loading) return Promise.resolve();

    // The CACHE decides, not `isFetched`. After hydration the flag can be true
    // with nothing behind it, and trusting it there left the page stuck on the
    // loading fallback forever.
    if (cachedFiles.has(this.cacheKey)) {
      this.loadCount = this.loadCount + 1;
      this.verifyAgainstCache();
      return Promise.resolve();
    }

    this.loading = true;
    return this.props
      .lazy()
      .then((res) => {
        const namedExport = this.props.namedExport ?? "default";

        if (!res[namedExport]) throw new Error(`Missing named export: ${namedExport}`);

        const component = res[namedExport];

        // Checked HERE, where the module is, rather than where it is rendered.
        // Anything not a class was taken as already callable and cached, so an
        // export that is neither surfaced a render later as "loadedComponent is
        // not a function" — a line that knows nothing about which module or
        // which export, and one the error fallback never saw, because nothing
        // had failed as far as the loading knew. A config object, a styles
        // module, a barrel file or a named export pointing at a constant all
        // land here, and they are the same mistake as the missing export above.
        if (typeof component !== "function") {
          throw new Error(
            `The "${namedExport}" export is a ${typeof component}, and only a component class or a function returning markup can be rendered.`,
          );
        }

        // Cached even if this component is gone: the next one to ask for the same
        // module should not have to fetch it again. `claim` is what keeps a second
        // module from landing on the first one's key — see it and verifyAgainstCache
        // for the two ways that is met.
        claim(this.cacheKey, this.props.lazy, component, this.props.cacheKey !== undefined);
        this.loading = false;
        if (this.disposed) return;
        this.loadCount = this.loadCount + 1;
      })
      .catch((e) => {
        /**
         * Development only, and named by its `cacheKey` so a page full of chunks says WHICH
         * one failed rather than logging a bare error.
         *
         * Not in production: the failure is already on the instance as `hasError` and `failure`,
         * and `errorFallback` is handed `{ error, retry, attempt }` — so the app renders it,
         * reports it where it likes, and offers the retry. An unconditional `console.error`
         * beside that is a second channel it cannot turn off, and a chunk that fails to load is
         * not always an incident: a deploy rotating its assets, a reader going offline, one
         * dropped request. In development the reason is what you need and there is nowhere else
         * it would go.
         */
        if (__DEV__) console.error(`[Ramonda] a lazily loaded component failed to load (${this.cacheKey}):`, e);
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

  @destroyed dispose() {
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
