export type {
  HashTag,
  RouterState,
  NavigateOptions,
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
// store now lives on the <Router> instance — reach it with `this.use(RouteHook)`.
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
} from "./match";
export {
  Router,
  RouteOutlet,
  RouteHook,
  type RouteOutletProps,
} from "./Router";
export { Link, type LinkProps } from "./Link";
