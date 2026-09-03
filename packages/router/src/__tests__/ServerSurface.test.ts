import { describe, expect, test } from "vitest";
import * as api from "../server";

/**
 * The `@ramonda/router/server` entry, asserted as a list.
 *
 * A second entry point is a second public surface, and `Object.keys` on one cannot see the other —
 * so it needs its own file, the same way `@ramonda/form/bguard` does. Without this, everything
 * behind `./server` could be added to or removed from with nothing to notice: the main entry's
 * surface test passes either way.
 *
 * The docs' `check-api-coverage.mjs` reads this list too, so a new export has to be acknowledged
 * twice — once as API, once as documentation.
 */
const EXPECTED = ["createIsrCache", "defineServer", "fileStore", "memoryStore", "routePlan"];

/**
 * The TYPES this entry publishes, which `Object.keys` cannot see.
 *
 * The store shapes are the ones that matter most. `IsrStore` is the interface somebody implements
 * to put the cache somewhere this package never thought of — Redis, S3 — so it is not a
 * convenience annotation but the extension point itself, and it is invisible to every runtime
 * check in this package.
 */
const EXPECTED_TYPES = [
  "FileStoreOptions",
  "IsrCache",
  "IsrCacheOptions",
  "IsrEntry",
  "IsrMode",
  "IsrPage",
  "IsrStore",
  "RoutePlan",
  "ServerConfig",
  "ServerOptions",
  "ServerRoute",
  "ServerRoutes",
];

describe("the /server entry's surface", () => {
  test("exports exactly what it means to", () => {
    const actual = Object.keys(api).sort();
    const expected = [...EXPECTED].sort();

    const added = actual.filter((name) => !expected.includes(name));
    const removed = expected.filter((name) => !actual.includes(name));

    expect({ added, removed }).toEqual({ added: [], removed: [] });
  });

  test("does not re-export the main entry", () => {
    // The two entries are separate on purpose: `./server` is imported by a server file, and
    // pulling `Router` or `createRouter` through it would put browser code in that graph.
    for (const name of ["Router", "RouteOutlet", "createRouter"]) {
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
  FileStoreOptions,
  IsrCache,
  IsrCacheOptions,
  IsrEntry,
  IsrMode,
  IsrPage,
  IsrStore,
  RoutePlan,
  ServerConfig,
  ServerOptions,
  ServerRoute,
  ServerRoutes,
} from "../server";
import type { RouteConfig } from "../index";

type _ServerSurface = [
  FileStoreOptions,
  IsrCache,
  IsrCacheOptions,
  IsrEntry,
  IsrMode,
  IsrPage,
  IsrStore,
  RoutePlan,
  ServerConfig<RouteConfig>,
  ServerOptions,
  ServerRoute,
  ServerRoutes,
];
