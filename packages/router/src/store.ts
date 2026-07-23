import type { NavigateOptions, RouterState, StateUpdater } from "./types";
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
 * component or hook, via `this.use(RouteHook)`.
 *
 * In the React design the route state was THREE things — reactive `state`,
 * synchronous `stateRef`, and a module-level `globalStateRef`. A Ramonda `@state`
 * field is the first two at once: reading it gives the synchronously updated
 * latest value (needed for race-free updaters) AND writing it re-renders. The
 * third is what is deleted here.
 */
export interface RouterNavigator {
  /**
   * THE single channel for every state change — declarative (<Link>) and
   * imperative (RouteHook.push) alike. The updater receives the freshest state,
   * so two near-simultaneous changes serialize instead of clobbering each other.
   *
   * Without a separate route-transition phase (we have no Next-style async
   * segment loading), "full" navigation is the same mechanic as "shallow": set
   * state + sync history. Changing `baseUrl` makes the reactive <Router>
   * re-match and swap the route component — that IS the transition.
   */
  updateState(updater: StateUpdater, options?: NavigateOptions): void;
  push(href: string, opts?: { scroll?: boolean }): void;
  replace(href: string, opts?: { scroll?: boolean }): void;
  back(): void;
  forward(): void;
}

/** Builds the navigation API over one store. Stable for that store's lifetime. */
export function createNavigator(store: RouteStateAccess): RouterNavigator {
  function updateState(updater: StateUpdater, options: NavigateOptions = {}): void {
    const next = updater(store.read()); // freshest, synchronous
    const url = buildUrl(next);

    store.write(next); // sync update + notifies subscribers → re-render

    if (options.replace) window.history.replaceState(null, "", url);
    else window.history.pushState(null, "", url);

    // Full navigations scroll to top by default; shallow ones don't unless asked.
    const scrollToTop = options.shallow ? options.scroll === true : options.scroll !== false;
    if (scrollToTop && typeof window.scrollTo === "function") {
      window.scrollTo(0, 0);
    }
  }

  return {
    updateState,
    push(href, opts) {
      updateState(() => parseUrlString(href), { scroll: opts?.scroll });
    },
    replace(href, opts) {
      updateState(() => parseUrlString(href), {
        replace: true,
        scroll: opts?.scroll,
      });
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
 * Stands in when a Link or RouteHook has no <Router> above it. Throwing beats
 * doing nothing quietly: without a Router there is no store to navigate.
 */
export const detachedNavigator: RouterNavigator = {
  updateState: refuse,
  push: refuse,
  replace: refuse,
  back: refuse,
  forward: refuse,
};
