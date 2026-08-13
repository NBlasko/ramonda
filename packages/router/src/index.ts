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
// `Anchor` and not `Link`: the kit `createRouter` hands back has a `Link` whose `href` is checked
// against the route table, and two importable names for that would be one name too many. This is the
// one for code that does NOT know an app's routes — a shared component in another package — and it
// takes any string. `Link` is reached through the kit, and nowhere else.
export { Anchor, type AnchorProps } from "./Anchor";
