import { describe, expect, test } from "vitest";
import * as api from "../index";

/**
 * What the package exports, asserted as a list.
 *
 * The same tripwire core and lens have, and for the same reason: an export added
 * for an internal convenience silently becomes public API, and a published surface
 * is much harder to take back than to refuse. Adding something on purpose means
 * updating this list; adding it by accident fails the build.
 *
 * The docs' `check-api-coverage.mjs` reads this list too, so a new export has to be
 * acknowledged twice — once as API, once as documentation.
 */
const EXPECTED = [
  "Query",
  "InfiniteQuery",
  "Mutation",
  "QueryClient",
  "QueryClientProvider",
  "QueryClientAccess",
  "ServerQueryError",
  "hashKey",
  "keyStartsWith",
];

/**
 * The internals a consumer must not reach.
 *
 * `resetKeyDiagnostics` is the sharp one: it clears the dedup set behind RMQ001, so
 * exporting it would let an app silence a diagnostic rather than fix the key. It
 * exists for this package's own tests, which import it by path.
 */
const FORBIDDEN = [
  "resetKeyDiagnostics",
  "createEntry",
  "isStale",
  "serializeError",
  "deserializeError",
  "requireClient",
];

describe("public API surface", () => {
  test("exports exactly what it means to", () => {
    const actual = Object.keys(api).sort();
    const expected = [...EXPECTED].sort();

    const added = actual.filter((name) => !expected.includes(name));
    const removed = expected.filter((name) => !actual.includes(name));

    expect({ added, removed }).toEqual({ added: [], removed: [] });
  });

  test("the internals are not reachable", () => {
    for (const name of FORBIDDEN) {
      expect(api).not.toHaveProperty(name);
    }
  });
});
