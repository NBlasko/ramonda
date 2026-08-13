import type { ComponentClassKind, RamondaNode } from "@ramonda/core";
import { Link as LinkImpl } from "./Link";
import { Router, RouteOutlet, Navigator as NavigatorImpl } from "./Router";
import type { PathOf, RouteConfig } from "./match";
import type { StateUpdater } from "./types";

/**
 * A path with its `:params` filled in, produced ONLY by `route()`.
 *
 * Branded so a raw pattern (`"/u/:id"`) pasted straight into an `href` does not type-check
 * as a ready URL — you have to build it through `route("/u/:id", { id })`, which is what
 * makes a missing or misspelled param a compile error rather than a broken link.
 */
export type Href = string & { readonly __href: unique symbol };

// Pull the `:param` names out of a pattern → the params object it needs.
type ParamNames<P extends string> = P extends `${string}:${infer Name}/${infer Rest}`
  ? Name | ParamNames<`/${Rest}`>
  : P extends `${string}:${infer Name}`
    ? Name
    : never;
type ParamsOf<P extends string> = { [K in ParamNames<P>]: string };

/** The `:param` patterns of a config — the only paths `route()` is for (static paths go direct). */
type ParamPath<C extends RouteConfig> = Extract<PathOf<C>, `${string}:${string}`>;

/**
 * Paths with NO `:param` — the ones valid as a literal `href`. A raw pattern like `"/u/:id"`
 * is a real route key but a broken URL, so it is excluded here: it must go through `route()`.
 * (This is why `href` is `StaticPath | Href`, not the whole path union — a raw pattern as an
 * href would type-check but render a literal `:id`, exactly the "wrong, not loud" case.)
 */
type StaticPath<C extends RouteConfig> = Exclude<PathOf<C>, `${string}:${string}`>;

/**
 * `<Link>` props, typed to one route table. `href` is the PLAIN path union or an `Href`
 * from `route()` — a static path goes in directly, a `:param` path must come through
 * `route()`. (Benchmarked: a plain union is the TS-cheap choice; excluding param paths
 * cost check time for no gain, since `route()` is the only thing that produces an `Href`.)
 */
export interface TypedLinkProps<P extends string> {
  href?: P | Href;
  replace?: boolean;
  /** Scroll to the top after navigating. Default `true`. */
  scroll?: boolean;
  /** Advanced: compute the target from route state (evaluated at render). Untyped href. */
  stateResolver?: StateUpdater;
  className?: string;
  children?: RamondaNode;
}

/**
 * The `Navigator` hook, typed to one route table: `push`/`replace` take only real paths.
 * Built from the real `Navigator` instance (so it keeps the hook's runtime shape and
 * satisfies `this.use`'s `BaseHook` constraint), with just `push`/`replace` narrowed.
 */
export type TypedNavigator<P extends string> = Omit<InstanceType<typeof NavigatorImpl>, "push" | "replace"> & {
  push(href: P | Href, opts?: { scroll?: boolean }): void;
  replace(href: P | Href, opts?: { scroll?: boolean }): void;
};

/**
 * Mirror of core's `HookClassKind<T, undefined>` (not exported) — a no-props hook class.
 * `runtime: any` so it stays assignable to core's `use()` parameter (the runtime type is
 * core-internal; a hook caller never supplies it).
 */
type NoPropsHookClass<T> = new (runtime: any, props: undefined) => T;

export interface TypedRouterKit<C extends RouteConfig> {
  /** Mount once on the app-root component: `router = this.use(Router)`. Unchanged. */
  Router: typeof Router;
  /** Renders whichever route matches. `<RouteOutlet routes={routes} />`. */
  RouteOutlet: typeof RouteOutlet;
  /** `this.use(Navigator)` — reads the URL + navigates, with `push`/`replace` typed to this table. */
  Navigator: NoPropsHookClass<TypedNavigator<StaticPath<C>>>;
  /** `<Link href="/…">` — `href` is a static path or an `Href` from `route()` (raw `:param` patterns rejected). */
  Link: ComponentClassKind<TypedLinkProps<StaticPath<C>>>;
  /**
   * Build an href for a `:param` pattern: `route("/u/:id", { id })`. The only thing that makes
   * an `Href`. Static paths are not accepted — pass them straight as `href="/about"`.
   */
  route<Pat extends ParamPath<C>>(pattern: Pat, params: ParamsOf<Pat>): Href;
}

/**
 * Binds the router surface to ONE route table, so `<Link href>` and `route()` are checked
 * against the paths that table actually declares. Change a route and a stale `href` becomes
 * a type error — the whole point.
 *
 * The returned `Link`/`Navigator`/`RouteOutlet`/`Router` are the SAME runtime implementations
 * (this only adds types); `route()` is the one piece of new runtime.
 *
 * ```ts
 * export const routes = createRoutes({ "/": <Home/>, "/u/:id": <Profile/> });
 * export const { Router, RouteOutlet, Navigator, Link, route } = createRouter(routes);
 *
 * <Link href="/" />                              // ✓
 * <Link href="/nope" />                           // ✗ not a route
 * <Link href={route("/u/:id", { id })} />         // ✓ typed params
 * ```
 */
export function createRouter<C extends RouteConfig>(_routes: C): TypedRouterKit<C> {
  return {
    Router,
    RouteOutlet,
    Navigator: NavigatorImpl as unknown as NoPropsHookClass<TypedNavigator<StaticPath<C>>>,
    Link: LinkImpl as unknown as ComponentClassKind<TypedLinkProps<StaticPath<C>>>,
    route: buildRoute as TypedRouterKit<C>["route"],
  };
}

/**
 * Fills a pattern's `:params` from the object: `/u/:id/p/:pid` + `{id:"a",pid:"b"}` →
 * `/u/a/p/b`. Each value is URL-encoded. The result is branded `Href`.
 */
function buildRoute(pattern: string, params: Record<string, string>): Href {
  const href = pattern.replace(/:(\w+)/g, (_match, name: string) => {
    const value = params[name];
    if (value === undefined) {
      throw new Error(`[Ramonda Router] route("${pattern}") is missing the "${name}" param.`);
    }
    return encodeURIComponent(value);
  });
  return href as Href;
}
