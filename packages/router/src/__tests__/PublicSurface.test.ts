import { describe, expect, test } from "vitest";
import * as api from "../index";

/**
 * What the package's main entry exports, asserted as a list.
 *
 * The same tripwire the other packages have: an export added for an internal convenience silently
 * becomes public API, and a published surface is much harder to take back than to refuse. Adding
 * something on purpose means updating this list; adding it by accident fails the build.
 *
 * The docs' `check-api-coverage.mjs` reads this list too, so a new export has to be acknowledged
 * twice — once as API, once as documentation.
 *
 * The `./server` entry is a second surface with its own file, `ServerSurface.test.ts`. A package
 * with two entries needs two lists: neither one can see the other's `Object.keys`.
 */
const EXPECTED = [
  "buildUrl",
  "createRouter",
  "createRoutes",
  "matchCompiled",
  "matchParams",
  "parseUrlString",
  "RouteOutlet",
  "routePaths",
  "Router",
  "sanitizeHref",
];

/**
 * The TYPES the main entry publishes, which `Object.keys` cannot see.
 *
 * Most of this package's surface is types, and that is what it is FOR: `createRouter` hands back a
 * kit whose `Link` and `Navigator` only accept paths the route table declares, and every one of the
 * `Typed…` names is how that reaches an annotation. A type dropped here is not a smaller API, it is
 * a caller who can no longer write down what they were given.
 */
const EXPECTED_TYPES = [
  "HashTag",
  "HashTagsUpdater",
  "Href",
  "NavigateOptions",
  "PartialNavigateOptions",
  "PathOf",
  "RouteConfig",
  "RouteOutletProps",
  "RouteParams",
  "RoutePaths",
  "RouterNavigator",
  "RouterState",
  "SearchParamsUpdater",
  "StateUpdater",
  "TypedLinkProps",
  "TypedNavigator",
  "TypedRouterKit",
];

/**
 * The internals a consumer must not reach.
 *
 * `Link` and `Navigator` are the sharp ones, and their absence is the design: they come from
 * `createRouter` so that they carry the route table's types. Exported bare they would be the
 * untyped versions of themselves, which is the API this package was rebuilt to remove.
 */
const FORBIDDEN = ["Link", "Navigator", "RouteHook", "store", "compile", "SPECS", "report"];

describe("public API surface", () => {
  test("exports exactly what it means to", () => {
    const actual = Object.keys(api).sort();
    const expected = [...EXPECTED].sort();

    const added = actual.filter((name) => !expected.includes(name));
    const removed = expected.filter((name) => !actual.includes(name));

    expect({ added, removed }).toEqual({ added: [], removed: [] });
  });

  test("the router kit is the only way to a Link", () => {
    for (const name of FORBIDDEN) {
      expect(api).not.toHaveProperty(name);
    }
  });

  test("every published type is named in EXPECTED_TYPES", () => {
    expect(new Set(EXPECTED_TYPES).size).toBe(EXPECTED_TYPES.length);
    expect(EXPECTED_TYPES).toEqual([...EXPECTED_TYPES].sort());
  });
});

// Every published type, named once, so `check-types` fails if one is renamed or removed.
import type {
  HashTag,
  HashTagsUpdater,
  Href,
  NavigateOptions,
  PartialNavigateOptions,
  PathOf,
  RouteConfig,
  RouteOutletProps,
  RouteParams,
  RoutePaths,
  RouterNavigator,
  RouterState,
  SearchParamsUpdater,
  StateUpdater,
  TypedLinkProps,
  TypedNavigator,
  TypedRouterKit,
} from "../index";

type _Surface = [
  HashTag,
  HashTagsUpdater,
  Href,
  NavigateOptions,
  PartialNavigateOptions,
  PathOf<RouteConfig>,
  RouteConfig,
  RouteOutletProps,
  RouteParams,
  RoutePaths,
  RouterNavigator,
  RouterState,
  SearchParamsUpdater,
  StateUpdater,
  TypedLinkProps<"/">,
  TypedNavigator<RouteConfig>,
  TypedRouterKit<RouteConfig>,
];
