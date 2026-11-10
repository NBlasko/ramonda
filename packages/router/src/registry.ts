import type { ComponentClassKind, RamondaNode } from "@ramonda/core";
import { Link as LinkImpl } from "./Link";
import { Navigator as NavigatorImpl } from "./Router";
import type { ParamsOf, PathOf, RouteConfig, RouteParams } from "./match";
import type { StateUpdater } from "./types";

/**
 * A path with its `:params` filled in, produced ONLY by `route()`.
 *
 * Branded so a raw pattern (`"/u/:id"`) pasted straight into an `href` does not type-check
 * as a ready URL — you have to build it through `route("/u/:id", { id })`, which is what
 * makes a missing or misspelled param a compile error rather than a broken link.
 */
export type BuiltHref = string & { readonly __href: unique symbol };

// `ParamNames` / `ParamsOf` moved to `match.ts`, the leaf both sides can reach: the READ side
// (`Navigator.params`) needs them too, and this module imports from `Router.tsx`.

/** The `:param` patterns of a config — the only paths `route()` is for (static paths go direct). */
type ParamPath<C extends RouteConfig> = Extract<PathOf<C>, `${string}:${string}`>;

/**
 * Paths with NO `:param` — the ones valid as a literal `href`. A raw pattern like `"/u/:id"`
 * is a real route key but a broken URL, so it is excluded here: it must go through `route()`.
 * (This is why `href` is `StaticPath | BuiltHref`, not the whole path union — a raw pattern as an
 * href would type-check but render a literal `:id`, exactly the "wrong, not loud" case.)
 */
type StaticPath<C extends RouteConfig> = Exclude<PathOf<C>, `${string}:${string}`>;

/**
 * `/users/:id` → `` `/users/${string}` ``, recursively, so every literal segment between the
 * parameters is still checked to the letter: `/t/1/p/2` passes and `/t/1/x/2` does not.
 *
 * `route()` is no longer the only way to write one. It stays for building an href programmatically,
 * but `<Link href="/users/42">` and `` href={`/users/${id}`} `` — an id that came from a backend —
 * are the ordinary case and they now type-check on their own.
 *
 * Known limit: the substituted segment is `${string}`, which a slash also satisfies, so
 * `/users/a/b` is accepted. Forbidding that needs the href prop to be generic over the literal
 * written at the call site, which is a larger change than this one.
 */
type Filled<S extends string> = S extends `${infer A}:${infer _P}/${infer Rest}`
  ? `${A}${string}/${Filled<Rest>}`
  : S extends `${infer A}:${infer _P}`
    ? `${A}${string}`
    : S;

/** A query with at least one `key=value`, so a bare `?tab` is still refused. */
type Search = `?${string}=${string}`;
type Hash = `#${string}`;

/**
 * Everywhere an href is accepted: a path the table names — filled in, if it takes parameters —
 * optionally with a query and a fragment, or a `BuiltHref` from `route()`.
 *
 * The looseness is ONLY behind the `?`. The path is checked as strictly as before: `/nope?x=1`
 * fails on the path, not the query. Runtime concatenation (`"/a?" + q`) widens to `string` and is
 * refused, so a query has to be written where it can be read.
 *
 * Measured before it went in: 50 routes and 2100 href sites cost 0.39s of check time against 0.34s
 * for a plain `string` — about 24 µs per site. TypeScript keeps these as PATTERNS rather than
 * expanding them, so the table's size enters linearly.
 */
type Located<P extends string> = P | `${P}${Search}` | `${P}${Hash}` | `${P}${Search}${Hash}`;
/**
 * `Located` over BOTH halves, including the `BuiltHref` that `route()` builds.
 *
 * Written out by hand the second half read `BuiltHref | \`${BuiltHref}${Search}\``, which let a built href
 * take a query but not a fragment — so `` href={`${route("/u/:id", { id })}#top`} `` was refused
 * while `href="/about#top"` was fine. An anchor into a section of a parameterised page is the
 * ordinary reason to write one, and there was no argument for the asymmetry; it was an omission.
 */
export type AnyHref<C extends RouteConfig> = Located<StaticPath<C> | Filled<ParamPath<C>> | BuiltHref>;

/**
 * `<Link>` props — `href` is an `Href` of the registered table.
 *
 * A path the table names, filled in if it takes parameters, optionally with a query and a
 * fragment; or a `BuiltHref` from `route()`, which is still the way to build one programmatically but
 * no longer the only way to write one.
 */
export interface TypedLinkProps<P extends string> {
  href?: P;
  replace?: boolean;
  /** Scroll to the top after navigating. Default `true`. */
  scroll?: boolean;
  /** Advanced: compute the target from route state (evaluated at render). Untyped href. */
  stateResolver?: StateUpdater;
  className?: string;
  children?: RamondaNode;
}

/**
 * Mirror of core's `HookClassKind<T, undefined>` (not exported) — a no-props hook class.
 *
 * `runtime: unknown` because a constructor PARAMETER is contravariant: for this to stay assignable to
 * core's `use()` parameter, its runtime argument has to accept core's real `Runtime`, and the widest
 * type accepts everything. `never` is the right bottom in a `extends new (...args: never[])` CONSTRAINT
 * and exactly wrong here — measured, it refuses the real class. The runtime type itself is
 * core-internal and a hook caller never supplies it.
 */
type NoPropsHookClass<T> = new (runtime: unknown, props: undefined) => T;

/**
 * Where an app registers its route table, ONCE, beside it:
 *
 * ```ts
 * export const routes = createRoutes({ "/": <Home />, "/u/:id": <Profile /> });
 *
 * declare module "@ramonda/router" {
 *   interface Register {
 *     routes: typeof routes;
 *   }
 * }
 * ```
 *
 * ## Why a registration and not a kit
 *
 * The types used to come from `createRouter(routes)`, imported from the module that holds the table.
 * That module imports every page — the table holds `<Home />` — and every page imported the kit back:
 * a cycle of modules, which works or not by the order a bundler loads them, and a cycle of types. A
 * component published in a package had no way to reach the table at all. Registered, a page imports
 * `Link` and `Navigator` from this package, the table is written once, and a package's `.d.ts` that
 * names `Href` is checked against the app's table where the app compiles it.
 *
 * Measured before it went in, on generated apps: 200 routes cost 0.36 s of check time against 0.33 s
 * for a kit, 1000 routes 1.54 s against 1.54 s, and a planted bad href was refused in both.
 *
 * One table per TypeScript program: two apps under one `tsconfig` share this interface.
 */
// biome-ignore lint/suspicious/noEmptyInterface: an app augments it
export interface Register {}

/**
 * What every typed place says when nothing was registered — as a TYPE, so the first `<Link href>`
 * fails with the fix in the message.
 *
 * Measured: a default of the loose table accepted every href SILENTLY and broke `params()` to
 * `never`, so a forgotten registration looked exactly like a correct app. Single quotes inside,
 * because TypeScript prints a string type in double ones and escapes every one inside it.
 */
export type Unregistered =
  "Register your route table: declare module '@ramonda/router' { interface Register { routes: typeof routes } }";

/** The registered table, or `never` when there is none. */
export type RegisteredRoutes = Register extends { routes: infer R extends RouteConfig } ? R : never;

type IfRegistered<T> = [RegisteredRoutes] extends [never] ? Unregistered : T;

/**
 * Every href the registered table accepts: a path it names, filled in if it takes parameters,
 * optionally with a query and a fragment, or what `route()` built.
 *
 * What a component in a PACKAGE types its href props with — `Component<{ href: Href }>` — so the
 * app's own table checks what the app passes, where the app compiles it.
 */
export type Href = IfRegistered<AnyHref<RegisteredRoutes>>;

/** The `:param` patterns the registered table declares. */
export type ParamPattern = IfRegistered<ParamPath<RegisteredRoutes>>;

/**
 * The `Navigator` hook, typed to the registered table: `push`/`replace` take only real paths.
 * Built from the real `Navigator` instance (so it keeps the hook's runtime shape and
 * satisfies `this.use`'s `BaseHook` constraint), with just `push`/`replace` narrowed.
 */
export type TypedNavigator = Omit<InstanceType<typeof NavigatorImpl>, "push" | "replace" | "params"> & {
  push(href: Href, opts?: { scroll?: boolean }): void;
  replace(href: Href, opts?: { scroll?: boolean }): void;
  /**
   * Name the pattern, and the params type comes out of it — `params("/u/:id")` is `{ id: string }`.
   *
   * Constrained to the patterns the table declares that actually have params. So a pattern the table
   * does not name is a type error, and a static path is refused because it has no params to read.
   *
   * The pattern is checked at runtime too, against what the outlet above matched — see
   * `assertPattern`. A type argument nothing verifies is the fault this router already refuses on the
   * writing side.
   */
  params<Pat extends ParamPattern>(pattern: Pat): ParamsOf<Pat>;
  /** The untyped door, unchanged: params are strings of unknown shape when no one route is meant. */
  params<T extends RouteParams = RouteParams>(): T;
};

/** `this.use(Navigator)` — reads the URL and navigates, with `push`/`replace` typed to the table. */
export const Navigator = NavigatorImpl as unknown as NoPropsHookClass<TypedNavigator>;

/** `<Link href="/…">` — `href` is any path the registered table names, filled in, or what `route()` built. */
export const Link = LinkImpl as unknown as ComponentClassKind<TypedLinkProps<Href>>;

/**
 * Build an href for a `:param` pattern: `route("/u/:id", { id })`. Static paths are not accepted —
 * pass them straight as `href="/about"`.
 *
 * Fills a pattern's `:params` from the object: `/u/:id/p/:pid` + `{id:"a",pid:"b"}` →
 * `/u/a/p/b`. Each value is URL-encoded.
 */
export function route<Pat extends ParamPattern>(pattern: Pat, params: ParamsOf<Pat>): BuiltHref;
export function route(pattern: string, params: Record<string, string>): BuiltHref {
  const href = pattern.replace(/:(\w+)/g, (_match, name: string) => {
    const value = params[name];
    if (value === undefined) {
      throw new Error(`[Ramonda Router] route("${pattern}") is missing the "${name}" param.`);
    }
    return encodeURIComponent(value);
  });
  return href as BuiltHref;
}
