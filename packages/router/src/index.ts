export type {
  RouterState,
  NavigateOptions,
  PartialNavigateOptions,
  SearchParamsUpdater,
  HashParamsUpdater,
  StateUpdater,
} from "./types";
export {
  parseUrlString,
  buildUrl,
  sanitizeHref,
} from "./urlUtils";
// The module-level `routerStore` / `router` / `updateState` singletons are gone
// on purpose: a module global is shared across concurrent server renders. The
// store now lives on the <Router> instance — reach it with `this.use(Navigator)`.
export type { RouterNavigator } from "./store";
export {
  matchParams,
  createRoutes,
  matchCompiled,
  routePaths,
  type RouteConfig,
  type RoutePart,
  type RouteParams,
  type RoutePaths,
  type PathOf,
} from "./match";
export { Router, RouteOutlet, HashLevel, type HashLevelProps, type RouteOutletProps } from "./Router";
/**
 * `Link`, `Navigator` and `route`, typed to the tables the app REGISTERS — see `Routes`.
 *
 * Each exists once, typed. The untyped `Link` and `Navigator` are not exported: an untyped one was
 * an equally short import that silently gave up the checking the typed one exists to provide.
 */
export {
  Link,
  Navigator,
  route,
  type Routes,
  type Href,
  type BuiltHref,
  type TypedLinkProps,
  type TypedNavigator,
} from "./registry";
