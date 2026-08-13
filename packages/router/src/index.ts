export type {
  HashTag,
  RouterState,
  NavigateOptions,
  PartialNavigateOptions,
  SearchParamsUpdater,
  HashTagsUpdater,
  StateUpdater,
} from "./types";
export {
  parseUrl,
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
  matchRoute,
  createRoutes,
  matchCompiled,
  routePaths,
  type RouteConfig,
  type RouteParams,
  type RoutePaths,
  type PathOf,
} from "./match";
export {
  Router,
  RouteOutlet,
  Navigator,
  type RouteOutletProps,
} from "./Router";
export {
  createRouter,
  type Href,
  type TypedLinkProps,
  type TypedNavigator,
  type TypedRouterKit,
} from "./createRouter";
export { Link, type LinkProps } from "./Link";
