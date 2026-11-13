import { dirname as surfaceDir, join as surfaceJoin } from "node:path";
import { fileURLToPath as surfaceUrl } from "node:url";
import { publishedTypes } from "../../../../scripts/surface/published-types";
import { describe, expect, test } from "vitest";
import * as api from "../index";

const SURFACE_SRC = surfaceJoin(surfaceDir(surfaceUrl(import.meta.url)), "..");

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
  "createRoutes",
  "HashLevel",
  "Link",
  "matchCompiled",
  "matchParams",
  "Navigator",
  "parseUrlString",
  "route",
  "RouteOutlet",
  "routePaths",
  "Router",
  "sanitizeHref",
];

/**
 * The TYPES the main entry publishes, which `Object.keys` cannot see.
 *
 * Most of this package's surface is types, and that is what it is FOR: `Link` and `Navigator` only
 * accept paths the table an app REGISTERS declares, `Href` is how a component in a package types an
 * href prop against that table, and the `Typed…` names are how the rest reaches an annotation. A type dropped here is not a smaller API, it is
 * a caller who can no longer write down what they were given.
 */
const EXPECTED_TYPES = [
  "BuiltHref",
  "HashLevelProps",
  "HashParamsUpdater",
  "Href",
  "NavigateOptions",
  "PartialNavigateOptions",
  "PathOf",
  "RouteConfig",
  "RouteOutletProps",
  "RouteParams",
  "RoutePart",
  "RoutePaths",
  "RouterNavigator",
  "RouterState",
  "Routes",
  "SearchParamsUpdater",
  "StateUpdater",
  "TypedLinkProps",
  "TypedNavigator",
];

/**
 * The internals a consumer must not reach. `createRouter` is gone: a kit imported from the module that
 * holds the table made every page and that module import each other — see `Routes`.
 */
const FORBIDDEN = ["createRouter", "RouteHook", "store", "compile", "SPECS", "report"];

describe("public API surface", () => {
  test("exports exactly what it means to", () => {
    const actual = Object.keys(api).sort();
    const expected = [...EXPECTED].sort();

    const added = actual.filter((name) => !expected.includes(name));
    const removed = expected.filter((name) => !actual.includes(name));

    expect({ added, removed }).toEqual({ added: [], removed: [] });
  });

  test("nothing internal, and no kit", () => {
    for (const name of FORBIDDEN) {
      expect(api).not.toHaveProperty(name);
    }
  });

  test("every published type is named in EXPECTED_TYPES", () => {
    expect(new Set(EXPECTED_TYPES).size).toBe(EXPECTED_TYPES.length);
    // From a real program: a type exported and missing from the list fails — a sorted list alone did not.
    expect(publishedTypes(surfaceJoin(SURFACE_SRC, "index.ts"), Object.keys(api), SURFACE_SRC)).toEqual(
      [...EXPECTED_TYPES].sort(),
    );
    expect(EXPECTED_TYPES).toEqual([...EXPECTED_TYPES].sort());
  });
});

// Every published type, named once, so `check-types` fails if one is renamed or removed.
import type {
  BuiltHref,
  HashLevelProps,
  HashParamsUpdater,
  Href,
  NavigateOptions,
  PartialNavigateOptions,
  PathOf,
  RouteConfig,
  RoutePart,
  RouteOutletProps,
  RouteParams,
  RoutePaths,
  RouterNavigator,
  RouterState,
  Routes,
  SearchParamsUpdater,
  StateUpdater,
  TypedLinkProps,
  TypedNavigator,
} from "../index";

type _Surface = [
  BuiltHref,
  HashLevelProps,
  HashParamsUpdater,
  Href,
  NavigateOptions,
  PartialNavigateOptions,
  PathOf<RouteConfig>,
  RouteConfig,
  RoutePart,
  RouteOutletProps,
  RouteParams,
  RoutePaths,
  RouterNavigator,
  RouterState,
  Routes,
  SearchParamsUpdater,
  StateUpdater,
  TypedLinkProps<"/">,
  TypedNavigator,
];
