import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { focusOn } from "../focus";

/**
 * A reporting package needs no DOM to report, which is the claim the reference page makes for the
 * diagnostics protocol — "the same line runs in the browser, in Node, in a worker and during a server
 * render" — and which nothing measured.
 *
 * It is measurable HERE and nowhere else in this repository. `@ramonda/lens` is the only package whose
 * tests run in vitest's `node` environment, so `window` is genuinely absent; every other suite either
 * runs under jsdom or, in `@ramonda/core`'s case, cannot use `node` at all, because
 * `packages/core/vite.config.ts` defines `__DEV__` as an expression and esbuild's `define` accepts only a
 * name or a literal.
 *
 * And core could not pass this test if it could run it: `debug/logger.ts` attaches a
 * `ramonda:devtools-ready` listener at module scope in DEV, so importing core with no DOM throws
 * `ReferenceError: window is not defined` before any of its own code runs. Measured. That is a
 * constraint on where core can be imported, not on the protocol — which is exactly why the reference
 * page's claim is written about a REPORTING package rather than about the framework.
 *
 * The other end of the same protocol — core's records reaching a collector during a real server render —
 * is `apps/playground-ssr/scripts/diagnostics.mjs`.
 */
describe("the diagnostics protocol with no DOM at all", () => {
  let records: RamondaDiagnostic[];

  beforeEach(() => {
    records = [];
    globalThis.__RAMONDA_DIAGNOSTICS__ = (record) => records.push(record);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    globalThis.__RAMONDA_DIAGNOSTICS__ = undefined;
    vi.restoreAllMocks();
  });

  test("there is no window here, so the assertion below is about something", () => {
    // The guard on the instrument: under jsdom this file would pass while proving nothing.
    expect(typeof window).toBe("undefined");
    expect(typeof document).toBe("undefined");
  });

  test("a report reaches the sink", () => {
    // `at` on a value that is not an array — RML003.
    focusOn({ a: 1 } as never)
      .at(0)
      .set(5 as never);

    expect(records.map((record) => record.code)).toEqual(["RML003"]);
    expect(records[0]!.scope).toBe("ramonda/lens");
    expect(records[0]!.time).toBeGreaterThan(1_700_000_000_000);
  });

  test("the record it produces is one a collector can ship", () => {
    focusOn({ a: 1 } as never)
      .at(0)
      .set(5 as never);

    // What a collector does with a record is serialize it, and `JSON.stringify` throws on a bigint and
    // on a cycle. Nothing in `data` may be either.
    expect(() => JSON.stringify(records[0])).not.toThrow();
    for (const value of Object.values(records[0]!.data ?? {})) {
      expect(["string", "number", "boolean"]).toContain(typeof value);
    }
  });

  test("with no sink installed it still reports to the console and does not throw", () => {
    globalThis.__RAMONDA_DIAGNOSTICS__ = undefined;

    expect(() =>
      focusOn({ a: 1 } as never)
        .at(0)
        .set(5 as never),
    ).not.toThrow();
    expect(records).toEqual([]);
  });
});
