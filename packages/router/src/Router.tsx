import { Component, Hook, createContext, state, compute, create, destroy, onWindow } from "@ramonda/core";
import { createNavigator, detachedNavigator, type RouterNavigator } from "./store";
import { parseUrl } from "./urlUtils";
import { matchCompiled, type RouteConfig, type RouteParams } from "./match";
import type { HashTag, RouterState } from "./types";

/**
 * What a <Router> publishes to its whole subtree. Split into separate keys on
 * purpose: the context hands out one signal per key, so a component reading only
 * `baseUrl` re-renders on a path change but not on a query-only change.
 *
 * `state` is the whole thing, for the rare consumer that needs it (a <Link> with
 * a stateResolver). Reading it means re-rendering on every navigation, so read a
 * narrower key when you can.
 */
interface RouteContextValue {
  state: RouterState;
  baseUrl: string;
  queryParams: Record<string, string>;
  hashTags: HashTag[];
  nav: RouterNavigator;
}

/** Published by <RouteOutlet>, because that is what does the matching. */
interface ParamsContextValue {
  params: RouteParams;
}

const EMPTY_STATE: RouterState = {
  baseUrl: "/",
  queryParams: {},
  hashTags: [],
};

const [RouteProvider, RouteContext] = createContext<RouteContextValue>(
  {
    state: EMPTY_STATE,
    baseUrl: "/",
    queryParams: {},
    hashTags: [],
    nav: detachedNavigator,
  },
  { label: "Route" },
);

const [ParamsProvider, ParamsContext] = createContext<ParamsContextValue>({ params: {} }, { label: "RouteParams" });

export { RouteContext };

/**
 * Live routers. Two cannot coexist: both would listen to popstate and both would
 * write history, and whichever unmounts first removes the listener the other
 * still needs. Cheaper to refuse than to debug.
 *
 * Counted from `@create({ env: "client" })`, so a server render never touches it.
 * That matters: a server render never unmounts, so an increment there would never
 * be undone and the *next* renderToString would throw.
 */
let liveRouters = 0;

/**
 * Owns the route state and publishes it to the whole subtree of the component
 * that uses it.
 *
 *   class App extends Component {
 *     private router = this.use(Router);
 *     render() {
 *       return <div class="app">
 *         <NavBar />                       ← has context, survives navigation
 *         <RouteOutlet routes={routes} />  ← the only part that swaps
 *       </div>;
 *     }
 *   }
 *
 * **A hook, not a component.** It was `<Router>{children}</Router>` until
 * 2026-07-17 — a pass-through wrapper, which is exactly what the framework's own
 * rule forbids: every component is exactly one element, so a component that only
 * forwards its children still costs a `<ramonda-host>` that means nothing. (The
 * same reasoning is why `createContext` returns hooks.) A hook owns the state and
 * adds no node.
 *
 * The state is per-instance rather than a module global so that concurrent server
 * renders cannot share it. See `store.ts`.
 */
export class Router extends Hook {
  /**
   * The route state. A plain `@state` field, so the signal behind it stays an
   * implementation detail — nothing an app touches ever sees the State class.
   *
   * Seeded from the URL at construction, re-read in `init()`, and re-read on
   * popstate. Those are the ONLY moments the URL is read as the source of truth.
   *
   * The seed here is not redundant with `init()`, and the two are not
   * interchangeable — each covers a case the other cannot:
   *
   * - This one runs on the SERVER too, where `init()` never does (it is
   *   `env: "client"`). It is also what `RouteProvider` publishes, because
   *   `useCommon` evaluates the options callback when the hook is constructed —
   *   before any lifecycle. Replace it with a placeholder and every route stops
   *   matching.
   * - `init()` covers hydration: `@state` auto-persists, so the SERVER's route
   *   arrives in the state blob and is restored over this seed. Without the
   *   re-read, `routeState` keeps the server's route — and so does the rendered
   *   page, measured `rendered: players | routeState.baseUrl: /players` while
   *   hydrating at `/`. (It used to render correctly while only the state was
   *   wrong; hydration now refreshes hook options after the restore, so
   *   `RouteProvider` publishes the restored route too.)
   *
   * Locked down by `__tests__/RouterHydration.test.tsx`.
   */
  @state private routeState: RouterState = parseUrl();

  /** Stable for this Router's lifetime, so consumers never see a new identity. */
  private nav = createNavigator({
    read: () => this.routeState,
    write: (next) => {
      this.routeState = next;
    },
  });

  /**
   * Client-only on purpose. `@create` defaults to `env: "shared"`, which runs on
   * the server too — and there is nothing to count there, because a server render
   * never unmounts to decrement it.
   */
  @create({ env: "client" })
  init() {
    if (liveRouters > 0) {
      throw new Error(
        "[Ramonda Router] A second Router was mounted while one is already live. " +
          "Two Routers conflict: both listen to popstate and both write history, and the first " +
          "to unmount removes the listener the other still depends on, so the survivor stops " +
          "reacting to back/forward. Use `this.use(Router)` once, on the component that wraps " +
          "your app. If you wanted a second place to render routes, use another <RouteOutlet> — " +
          "those may be nested freely.\n\n" +
          "If you only have one Router, the previous one was never unmounted: this counter is " +
          "decremented from @destroy, so a tree whose DOM was thrown away without `unmount(container)` " +
          "leaves it standing forever, and every later mount throws here. In tests, unmount in a " +
          "`finally` so a failed assertion cannot skip it.",
      );
    }
    liveRouters++;

    // The client's URL is the truth, whatever was restored into state.
    this.routeState = parseUrl();
  }

  @destroy dispose() {
    liveRouters--;
  }

  /**
   * Back/Forward: the browser changed the URL without us — re-parse it.
   *
   * `@onWindow` rather than a hand-rolled addEventListener in `@create`: it is
   * built on an effect, and effects never run on the server, so the listener
   * cannot be attached there. It also removes itself on unmount, so there is no
   * cleanup to forget.
   */
  @onWindow("popstate")
  handlePopState(): void {
    this.routeState = parseUrl();
  }

  /**
   * Mounted for its effect: publishing route state to every descendant. Nothing
   * reads this field, and TypeScript's language service flags an unused PRIVATE
   * member (a hint, not a build error — neither tsconfig sets `noUnusedLocals`).
   *
   * `protected` rather than `private` because that is the accurate visibility,
   * not to silence the hint: a subclassed Router should be able to reach its own
   * provider. Dropping the modifier entirely would put it in the public API,
   * which for a hook means any consumer could read it.
   */
  protected routeProvider = this.use(RouteProvider, () => ({
    state: this.routeState,
    baseUrl: this.routeState.baseUrl,
    queryParams: this.routeState.queryParams,
    hashTags: this.routeState.hashTags,
    nav: this.nav,
  }));
}

export interface RouteOutletProps {
  /** A stable config from `createRoutes(...)` — see why in match.ts. */
  routes: RouteConfig;
}

/**
 * Renders whichever route matches the current path. Re-matches reactively when
 * the path changes — that reactive swap IS the "route transition".
 *
 * Needs a <Router> above it. Outlets may be nested: each publishes its own
 * :params to its own subtree.
 */
export class RouteOutlet extends Component<RouteOutletProps> {
  private ctx = this.use(RouteContext);

  // Computed ONCE per path/routes change (cached). Both the params provider and
  // render read it, so a navigation runs the regex match a single time.
  @compute private get match() {
    return matchCompiled(this.ctx.baseUrl, this.props.routes);
  }

  private paramsProvider = this.use(ParamsProvider, () => ({
    params: this.match.params,
  }));

  render() {
    return this.match.vnode;
  }
}

/**
 * Reactive router readers + imperative navigation (the useRouter/useSearchParams
 * /usePathname/useParams equivalents). Needs a <Router> ancestor.
 *
 * Each getter reads one context key, so a component using only `pathname`
 * re-renders on a path change and ignores query-only ones. `params()` reads a
 * different context, published by the enclosing <RouteOutlet> — so chrome above
 * the outlet can use everything here except `params()`.
 */
export class RouteHook extends Hook {
  private ctx = this.use(RouteContext);
  private paramsCtx = this.use(ParamsContext);

  get pathname(): string {
    return this.ctx.baseUrl;
  }
  get searchParams(): Record<string, string> {
    return this.ctx.queryParams;
  }
  get hashTags(): HashTag[] {
    return this.ctx.hashTags;
  }

  /** The matched route's :params. Needs a <RouteOutlet> above. */
  params<T extends RouteParams = RouteParams>(): T {
    return this.paramsCtx.params as T;
  }

  push(href: string, opts?: { scroll?: boolean }): void {
    this.ctx.nav.push(href, opts);
  }
  replace(href: string, opts?: { scroll?: boolean }): void {
    this.ctx.nav.replace(href, opts);
  }
  back(): void {
    this.ctx.nav.back();
  }
  forward(): void {
    this.ctx.nav.forward();
  }
}
