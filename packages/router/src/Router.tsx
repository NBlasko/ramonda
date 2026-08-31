import {
  Component,
  Hook,
  createContext,
  state,
  compute,
  created,
  destroyed,
  onWindow,
  captureServerRedirect,
} from "@ramonda/core";
import { createNavigator, detachedNavigator, type RouterNavigator } from "./store";
import { parseUrl } from "./urlUtils";
import { assertPattern, matchCompiled, type ParamsOf, type RouteConfig, type RouteParams } from "./match";
import type { HashTag, HashTagsUpdater, PartialNavigateOptions, RouterState, SearchParamsUpdater } from "./types";

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
  /**
   * The route key that matched — `/users/:id`, not `/users/9`.
   *
   * Carried so `params(pattern)` can say WHICH route it is standing on when the pattern names a
   * param that route does not supply. `undefined` means no outlet above at all, which is a different
   * message and a legitimate arrangement: a nav bar beside the outlet has no matched route.
   */
  key: string | undefined;
}

const EMPTY_STATE: RouterState = {
  baseUrl: "/",
  queryParams: {},
  hashTags: [],
};

const [RouteProvider, RouteConsumer] = createContext<RouteContextValue>(
  {
    state: EMPTY_STATE,
    baseUrl: "/",
    queryParams: {},
    hashTags: [],
    nav: detachedNavigator,
  },
  /**
   * `single`, because a second Router is a CONFLICT and not a narrower scope: both listen to
   * `popstate` and both write history, and the first to unmount takes the listener the survivor
   * depends on. `Router.init` throws when it happens; this is the same fault said before anything
   * renders, on every path the source can produce.
   *
   * The params context below is deliberately NOT single — outlets nest freely, and a nested one
   * publishing its own matched params is the point.
   */
  { label: "Route", single: true },
);

/**
 * `optional`, and it is the one context here that is: `{}` is a real answer, not a stand-in.
 * Params are published by a <RouteOutlet> for the route it matched, so a nav bar, a header or
 * a footer BESIDE the outlet has no matched route above it and correctly has no params.
 * `Navigator` holds this consumer for everyone, so reporting its absence would accuse the very
 * arrangement the router documents.
 */
const [ParamsProvider, ParamsConsumer] = createContext<ParamsContextValue>(
  { params: {}, key: undefined },
  { label: "RouteParams", optional: true },
);

export { RouteConsumer };

/**
 * Live routers. Two cannot coexist: both would listen to popstate and both would
 * write history, and whichever unmounts first removes the listener the other
 * still needs. Cheaper to refuse than to debug.
 *
 * Counted from `@created({ env: "client" })`, so a server render never touches it.
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
 * 2026-07-17 — a tag that drew nothing, so a reader had to know it was there to
 * know what it covered. The router owns state for a whole subtree and puts
 * nothing on the page, which is what a hook is for. (The same reasoning is why
 * `createContext` returns hooks.)
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

  /**
   * On a server render this is a function that records a redirect for the request;
   * on the client it is `undefined`. Captured here, at construction, because that
   * is inside the synchronous server-mount window where the render's redirect slot
   * is reachable — and the captured closure keeps working when a guard fires later
   * from an async `@mounted`. See core's `captureServerRedirect`.
   */
  private serverRedirect = captureServerRedirect();

  /** Stable for this Router's lifetime, so consumers never see a new identity. */
  private nav = createNavigator(
    {
      read: () => this.routeState,
      write: (next) => {
        this.routeState = next;
      },
    },
    this.serverRedirect,
  );

  // Reading the URL and navigating — the same surface `Navigator` exposes, so the
  // component that mounts the Router can read and navigate directly without also
  // using a Navigator. It reads its own `routeState` (not context), because the
  // Router sits ABOVE its own provider. The one thing missing is `params()`: those
  // come from a <RouteOutlet> below, so only a Navigator under an outlet has them.
  get pathname(): string {
    return this.routeState.baseUrl;
  }
  get searchParams(): Record<string, string> {
    return this.routeState.queryParams;
  }
  get hashTags(): HashTag[] {
    return this.routeState.hashTags;
  }

  push(href: string, opts?: { scroll?: boolean }): void {
    this.nav.push(href, opts);
  }
  replace(href: string, opts?: { scroll?: boolean }): void {
    this.nav.replace(href, opts);
  }
  updateSearchParams(next: SearchParamsUpdater, opts?: PartialNavigateOptions): void {
    this.nav.updateSearchParams(next, opts);
  }
  updateHashTags(next: HashTagsUpdater, opts?: PartialNavigateOptions): void {
    this.nav.updateHashTags(next, opts);
  }
  back(): void {
    this.nav.back();
  }
  forward(): void {
    this.nav.forward();
  }

  /**
   * Client-only on purpose. `@created` defaults to `env: "shared"`, which runs on
   * the server too — and there is nothing to count there, because a server render
   * never unmounts to decrement it.
   */
  @created({ env: "client" })
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
          "decremented from @destroyed, so a tree whose DOM was thrown away without `unmount(container)` " +
          "leaves it standing forever, and every later mount throws here. In tests, unmount in a " +
          "`finally` so a failed assertion cannot skip it.",
      );
    }
    liveRouters++;

    // The client's URL is the truth, whatever was restored into state.
    this.routeState = parseUrl();
  }

  @destroyed dispose() {
    liveRouters--;
  }

  /**
   * Back/Forward: the browser changed the URL without us — re-parse it.
   *
   * `@onWindow` rather than a hand-rolled addEventListener in `@created`: it is
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
  private ctx = this.use(RouteConsumer);

  // Computed ONCE per path/routes change (cached). Both the params provider and
  // render read it, so a navigation runs the regex match a single time.
  @compute private get match() {
    return matchCompiled(this.ctx.baseUrl, this.props.routes);
  }

  private paramsProvider = this.use(ParamsProvider, () => ({
    params: this.match.params,
    key: this.match.key,
  }));

  render() {
    return this.match.vnode;
  }
}

/**
 * Reactive router readers (pathname, searchParams, hashTags, params) plus
 * imperative navigation (push, replace, updateSearchParams, …). Needs a <Router>
 * ancestor.
 *
 * Each getter reads one context key, so a component using only `pathname`
 * re-renders on a path change and ignores query-only ones. `params()` reads a
 * different context, published by the enclosing <RouteOutlet> — so chrome above
 * the outlet can use everything here except `params()`.
 */
export class Navigator extends Hook {
  private ctx = this.use(RouteConsumer);
  private paramsCtx = this.use(ParamsConsumer);

  get pathname(): string {
    return this.ctx.baseUrl;
  }
  get searchParams(): Record<string, string> {
    return this.ctx.queryParams;
  }
  get hashTags(): HashTag[] {
    return this.ctx.hashTags;
  }

  /**
   * The matched route's `:params`. Needs a `<RouteOutlet>` above.
   *
   * ## Two doors, and the typed one is the default
   *
   * `params("/users/:id")` names the pattern and the type comes OUT of it — `{ id: string }` — with
   * no annotation to keep in step with the route table. That is the same `ParamNames` machinery
   * `route("/users/:id", { id })` has always used for building an href, pointed the other way: the
   * writing side has been typed from the pattern since the kit existed, and this is the reading side
   * catching up.
   *
   * `params<T>()` still works and stays. Params come out of a URL and are genuinely `string`s of
   * unknown shape when a component is not written against one route, and a door for that is worth
   * having.
   *
   * ## Why the pattern is CHECKED rather than trusted
   *
   * A named pattern is a claim about which route this component is standing on, and a claim nothing
   * verifies is the shape of fault this router already refuses on the other side:
   * `route("/u/:id", {})` throws for a missing param rather than building `/u/undefined`. The mirror
   * of that is a component naming `"/users/:id"` while the outlet above it matched a route with no
   * `id` — `.id` would be `undefined` typed as `string`, and it would travel.
   *
   * So each `:name` in the pattern must be present in what the outlet matched. Note what that does
   * NOT do: it does not demand the pattern EQUAL the matched key. A component rendered by both
   * `/users/:id` and `/people/:id` names one of them and is right on both, because the type it asks
   * for is satisfied on both — the check is about the params, not about the spelling.
   *
   * It throws in every build, like its counterpart above it in `createRouter.ts`, and for the same
   * reason: the read is broken either way, and a development-only report would let it ship.
   */
  params<T extends RouteParams = RouteParams>(): T;
  params<Pat extends string>(pattern: Pat): ParamsOf<Pat>;
  params(pattern?: string): RouteParams {
    const params = this.paramsCtx.params;
    if (pattern !== undefined) assertPattern(pattern, params, this.paramsCtx.key);
    return params;
  }

  push(href: string, opts?: { scroll?: boolean }): void {
    this.ctx.nav.push(href, opts);
  }
  replace(href: string, opts?: { scroll?: boolean }): void {
    this.ctx.nav.replace(href, opts);
  }
  updateSearchParams(next: SearchParamsUpdater, opts?: PartialNavigateOptions): void {
    this.ctx.nav.updateSearchParams(next, opts);
  }
  updateHashTags(next: HashTagsUpdater, opts?: PartialNavigateOptions): void {
    this.ctx.nav.updateHashTags(next, opts);
  }
  back(): void {
    this.ctx.nav.back();
  }
  forward(): void {
    this.ctx.nav.forward();
  }
}
