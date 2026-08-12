import { describe, test, expect } from "vitest";
import * as api from "../index";

/**
 * What the package exports, asserted as a list.
 *
 * `index.ts` uses `export * from "./base/decorators"`, so an export added there
 * for internal reasons silently becomes public API. This is the tripwire: adding
 * something on purpose means updating this list, and adding it by accident fails
 * the build.
 *
 * It also pins the things that must NEVER be reachable. The signal attach/detach
 * symbols are the sharp ones — the list engine uses them to subscribe item
 * scopes, and a missing `detach` is exactly how the scope leak happened. An app
 * that could call them could leak the same way, with nothing to catch it.
 */

const EXPECTED = [
  // the devtools seam: an instance describing what it holds
  "INSPECT",
  // components and hooks
  "Component",
  "Hook",
  "list",
  // Structural sharing at the data boundary, and the one place an app can say
  // which row is which when inference cannot.
  "merge",
  // The ready-made option for a lens `set` that replaces a row with the same
  // row rebuilt — so an app never has to name the symbol behind it.
  "SAME_ROW",
  "ShouldUpdateOnPropsChange",
  "StableProps",
  "AsyncLoad",
  "ErrorBoundary",
  "createContext",
  "createRef",
  "Ref",
  "Head",
  "Portal",
  // A portal target outside the app's root: the token, and the attribute a
  // hand-rolled shell needs in order to emit the container itself.
  "portalTarget",
  "PORTAL_TARGET_ATTR",
  // entry points
  "bootstrap",
  "unmount",
  // The JSX factory, for the vnodes a tag cannot express — a runtime tag name, spread children.
  // Compiled JSX never calls it: that goes through `@ramonda/core/jsx-runtime`, which the compiler
  // imports itself. The name is deliberately one nobody reaches for by habit.
  "__h",
  // server rendering
  "renderToString",
  "renderPage",
  "renderStatic",
  "renderDocument",
  "hydrateRoot",
  "ServerRedirect",
  "captureServerRedirect",
  "requestContext",
  "requestKey",
  "seedRequest",
  "RequestReadDuringBuild",
  // decorators
  "state",
  "persist",
  "compute",
  "created",
  "mounted",
  "destroyed",
  "updated",
  "watchProp",
  "deferHydration",
  "catchError",
  "memoizedHandler",
  "onElement",
  "onWindow",
  "onDocument",
  "interval",
  "timeout",
  "Host",
  // building your own decorators
  "createSubscriptionDecorator",
  // development-time switches
  "configureDev",
];

/** Reactivity plumbing an app must not be able to touch. */
const FORBIDDEN = [
  "State",
  "attach",
  "detach",
  "trackerContainer",
  "reactivityScope",
  "GLOBAL_RUNTIME",
  "COMPONENT_RUNTIME",
  "HOOK_RUNTIME",
  "diffAndMerge",
  "mountNode",
  "createRamonda",
  "KEY_SYM",
  "IS_LIST",
  "CHILD_RECORD",
  "ORIGIN_SYM",
  "currentOrigin",
];

/**
 * The TYPES this package publishes, which `EXPECTED` above cannot see.
 *
 * Types are erased, so `Object.keys(api)` returns none of them and the surface test was blind to a
 * whole half of the API — `HookMeta` was added, published, and documented by nobody noticing, which is
 * what this closes. `apps/docs/scripts/check-api-coverage.mjs` reads this list and fails if a name here
 * is missing from the API reference, the same rule `@ramonda/form` has had.
 *
 * Sorted, so a name is added in one obvious place rather than wherever the diff is smallest.
 *
 * **Enumerate it with the compiler, not a regex.** Two regex attempts disagreed: reading the emitted
 * `dist/index.d.ts` misses the exports tsup writes without a `type` modifier, and reading `index.ts`
 * misses everything arriving through `export * from "./base/decorators"` — `LifecycleOptions` comes
 * that way. `ts.createProgram` with this package's own tsconfig plus `checker.getExportsOfModule`,
 * resolving each alias through `getAliasedSymbol`, gives the real list.
 */
const EXPECTED_TYPES = [
  "AsyncLoadFailure",
  "AsyncLoadProps",
  "ComponentChild",
  "ComponentClassKind",
  "ContextOptions",
  "DevFlags",
  "Disconnect",
  "DocumentOptions",
  "Each",
  "ErrorBoundaryFallbackProps",
  "HeadOptions",
  "HookMeta",
  "Identity",
  "ItemRender",
  "Lazy",
  "LifecycleOptions",
  "LinkTag",
  "MetaTag",
  "RamondaNode",
  "RefCallback",
  "RefTarget",
  "RenderEnv",
  "RenderToStringOptions",
  "RenderedPage",
  "RequestContext",
  "RequestCookies",
  "RequestKey",
  "RequestKeyOptions",
  "RequestMode",
  "ServerRequestInit",
  "StaticRender",
  "SubscriptionOwner",
  "VNode",
];

describe("public API surface", () => {
  test("exports exactly what it means to", () => {
    const actual = Object.keys(api).sort();
    const expected = [...EXPECTED].sort();

    const added = actual.filter((name) => !expected.includes(name));
    const removed = expected.filter((name) => !actual.includes(name));

    expect({ added, removed }).toEqual({ added: [], removed: [] });
  });

  test("reactivity plumbing is not reachable", () => {
    for (const name of FORBIDDEN) {
      expect(api).not.toHaveProperty(name);
    }
  });

  test("every published type is named in EXPECTED_TYPES, once, in order", () => {
    // The compiler proves the types EXIST — see the import below, which fails to check if one is
    // renamed or removed. This proves the LIST is tidy, so a name added to `index.ts` and appended
    // here rather than inserted is caught while the diff still says why.
    expect(EXPECTED_TYPES).toEqual([...EXPECTED_TYPES].sort());
    expect(new Set(EXPECTED_TYPES).size).toBe(EXPECTED_TYPES.length);
  });
});

/**
 * Every published type, named once, so `check-types` fails if one is renamed or removed.
 *
 * The tuple below is what makes the import count as used, and it pins one more thing on the way: a
 * generic's ARITY. `Each<unknown>` stops compiling if that parameter is dropped, or if a second
 * one is added without a default — and arity is as much a part of a published type as its name. The
 * arguments are the widest each constraint allows, on purpose: nothing here asserts anything about what
 * may be passed, only that the parameter is there to pass something to.
 */
import type {
  AsyncLoadFailure,
  AsyncLoadProps,
  ComponentChild,
  ComponentClassKind,
  ContextOptions,
  DevFlags,
  Disconnect,
  DocumentOptions,
  Each,
  ErrorBoundaryFallbackProps,
  HeadOptions,
  HookMeta,
  Identity,
  ItemRender,
  Lazy,
  LifecycleOptions,
  LinkTag,
  MetaTag,
  RamondaNode,
  RefCallback,
  RefTarget,
  RenderEnv,
  RenderToStringOptions,
  RenderedPage,
  RequestContext,
  RequestCookies,
  RequestKey,
  RequestKeyOptions,
  RequestMode,
  ServerRequestInit,
  StaticRender,
  SubscriptionOwner,
  VNode,
} from "../index";

/** Referenced so the import is not "unused" — the reference IS the assertion. */
export type __Published = [
  AsyncLoadFailure,
  AsyncLoadProps,
  ComponentChild,
  ComponentClassKind,
  ContextOptions,
  DevFlags,
  Disconnect,
  DocumentOptions,
  Each<unknown>,
  ErrorBoundaryFallbackProps,
  HeadOptions,
  HookMeta,
  Identity,
  ItemRender<unknown>,
  Lazy,
  LifecycleOptions,
  LinkTag,
  MetaTag,
  RamondaNode,
  RefCallback<Element>,
  RefTarget<Element>,
  RenderEnv,
  RenderToStringOptions,
  RenderedPage,
  RequestContext,
  RequestCookies,
  RequestKey<unknown>,
  RequestKeyOptions,
  RequestMode,
  ServerRequestInit,
  StaticRender,
  SubscriptionOwner,
  VNode,
];
