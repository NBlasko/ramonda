import type {
  HashTagsUpdater,
  NavigateOptions,
  PartialNavigateOptions,
  RouterState,
  SearchParamsUpdater,
  StateUpdater,
} from "./types";
import { buildUrl, parseUrlString } from "./urlUtils";

/**
 * How the navigator reaches the route state. Deliberately just two functions
 * rather than a `State`: the <Router> holds its route state in a plain `@state`
 * field, so the signal stays an implementation detail and `State` never appears
 * in anything an app touches.
 *
 * `read()` must be synchronously freshest — the whole race-free updater design
 * rests on it.
 */
export interface RouteStateAccess {
  read(): RouterState;
  write(next: RouterState): void;
}

/**
 * Imperative navigation, scoped to one <Router>.
 *
 * This used to be a module-level singleton, so any code anywhere could call
 * `router.push(...)`. Convenient, and wrong on the server: a module global is
 * shared by every concurrent request, so two requests rendering different URLs
 * would trample each other's route state. The store now belongs to the <Router>
 * instance and reaches components through context — one store per render tree.
 *
 * The price is that navigation is only reachable where the context is: from a
 * component or hook, via `this.use(Navigator)`.
 *
 * A single `@state` field carries the route state. Reading it gives the
 * synchronously updated latest value (what race-free updaters need) AND writing it
 * re-renders — one field doing both jobs, with no separate synchronous ref and no
 * module-level global to keep in sync.
 */
export interface RouterNavigator {
  /**
   * THE single channel for every state change — declarative (<Link>) and
   * imperative (push / updateSearchParams / …) alike. The updater receives the
   * freshest state, so two near-simultaneous changes serialize instead of
   * clobbering each other.
   *
   * There is no separate "route transition" phase and no async segment loading:
   * every change is set-state + sync-history. Whether the route COMPONENT swaps is
   * decided downstream and purely by `baseUrl` — a <RouteOutlet> re-matches only
   * when the path changes, so a query- or hash-only change updates its readers
   * without touching the matched route.
   */
  updateState(updater: StateUpdater, options?: NavigateOptions): void;
  push(href: string, opts?: { scroll?: boolean }): void;
  replace(href: string, opts?: { scroll?: boolean }): void;
  /**
   * Change ONLY the query params, race-free. The functional form receives the
   * freshest params, so two filters changed in the same tick serialize instead of
   * clobbering — the second reads the first's write. `baseUrl` is untouched, so no
   * route re-match happens. Stays in place unless `scroll: true` is passed.
   */
  updateSearchParams(next: SearchParamsUpdater, opts?: PartialNavigateOptions): void;
  /** Change ONLY the hash tags, same race-free contract as updateSearchParams. */
  updateHashTags(next: HashTagsUpdater, opts?: PartialNavigateOptions): void;
  back(): void;
  forward(): void;
}

/**
 * Builds the navigation API over one store. Stable for that store's lifetime.
 *
 * `onServerRedirect` is passed only during a server render (the <Router> captures
 * it from core at construction; it is `undefined` on the client). When present,
 * every navigation is treated as "this request belongs at another URL": it is
 * recorded for the server to answer with a redirect, and nothing else happens —
 * no history to push, and no point re-rendering a tree the response will discard.
 */
export function createNavigator(store: RouteStateAccess, onServerRedirect?: (url: string) => void): RouterNavigator {
  function updateState(updater: StateUpdater, options: NavigateOptions = {}): void {
    const next = updater(store.read()); // freshest, synchronous
    const url = buildUrl(next);

    if (onServerRedirect) {
      onServerRedirect(url);
      return;
    }

    store.write(next); // sync update + notifies subscribers → re-render

    if (options.replace) window.history.replaceState(null, "", url);
    else window.history.pushState(null, "", url);

    // Scroll is now an explicit choice with no hidden default here: each caller
    // resolves its own default (a full navigation → true, an in-place update →
    // false) and passes a definite boolean.
    if (options.scroll === true && typeof window.scrollTo === "function") {
      window.scrollTo(0, 0);
    }
  }

  return {
    updateState,
    push(href, opts) {
      // A real navigation to another page — scroll to the top unless told not to.
      updateState(() => parseUrlString(href), { scroll: opts?.scroll !== false });
    },
    replace(href, opts) {
      updateState(() => parseUrlString(href), {
        replace: true,
        scroll: opts?.scroll !== false,
      });
    },
    updateSearchParams(next, opts = {}) {
      updateState(
        (prev) => ({
          ...prev,
          queryParams: typeof next === "function" ? next(prev.queryParams) : next,
        }),
        { replace: opts.replace, scroll: opts.scroll === true },
      );
    },
    updateHashTags(next, opts = {}) {
      updateState(
        (prev) => ({
          ...prev,
          hashTags: typeof next === "function" ? next(prev.hashTags) : next,
        }),
        { replace: opts.replace, scroll: opts.scroll === true },
      );
    },
    back() {
      window.history.back();
    },
    forward() {
      window.history.forward();
    },
  };
}

function refuse(): never {
  throw new Error(
    "[Ramonda Router] Navigation was attempted with no <Router> above this component. " +
      "The route store belongs to a <Router> instance and reaches components through context, " +
      "so navigation only works inside its tree. Mount a <Router> at the root of your app.",
  );
}

/**
 * Stands in when a Link or Navigator has no <Router> above it. Throwing beats
 * doing nothing quietly: without a Router there is no store to navigate.
 */
export const detachedNavigator: RouterNavigator = {
  updateState: refuse,
  push: refuse,
  replace: refuse,
  updateSearchParams: refuse,
  updateHashTags: refuse,
  back: refuse,
  forward: refuse,
};
