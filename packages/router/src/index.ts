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
  parseUrlString,
  buildUrl,
  sanitizeHref,
} from "./urlUtils";
// The module-level `routerStore` / `router` / `updateState` singletons are gone
// on purpose: a module global is shared across concurrent server renders. The
// store now lives on the <Router> instance — reach it with `this.use(Navigator)`, taking
// `Navigator` from `createRouter`.
export type { RouterNavigator } from "./store";
export {
  matchParams,
  createRoutes,
  matchCompiled,
  routePaths,
  type RouteConfig,
  type RouteParams,
  type RoutePaths,
  type PathOf,
} from "./match";
/**
 * `Router` and `RouteOutlet` only. `Navigator` and `Link` are reached through `createRouter`, and
 * nowhere else.
 *
 * Those two exist in two versions — the kit casts them so `push`, `replace` and `href` accept only
 * paths in your table — and the untyped one was an equally short import that silently gave up the
 * checking the typed one exists to provide. Not one app in this repository was using `createRouter`
 * when this was measured, which says the wrong door was not chosen so much as walked through.
 *
 * A second NAME for each was tried first and abandoned: it worked for `Link` only because HTML had
 * a word for the raw thing (`Anchor`), and there is no such word for a navigator. Five members
 * would have meant five separate arguments about vocabulary. One door needs none.
 *
 * `Router` and `RouteOutlet` stay because they have exactly ONE version — the kit hands them back
 * unchanged, `typeof Router` — so there is nothing here to pick wrongly.
 */
export { Router, RouteOutlet, type RouteOutletProps } from "./Router";
export {
  createRouter,
  type Href,
  type TypedLinkProps,
  type TypedNavigator,
  type TypedRouterKit,
} from "./createRouter";
