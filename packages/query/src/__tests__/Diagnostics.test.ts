import { beforeEach, afterEach, describe, expect, test, vi } from "vitest";
import { hashKey, resetKeyDiagnostics } from "../hashKey";

/**
 * The records this package hands a collector.
 *
 * A written contract is the one thing in this repository with nothing behind it, so the shape is
 * asserted rather than described — and it is asserted over records this package really produced,
 * not over the table they were read from. `@ramonda/devtools` compares the declaration itself
 * across packages; this is the other half.
 *
 * See https://ramonda.dev/reference/diagnostics#capturing-them.
 */

let records: RamondaDiagnostic[] = [];
let errors: ReturnType<typeof vi.spyOn>;

/**
 * Only this package's records. The sink is ONE global and every package writes to it.
 *
 * **Measured, as a failure inside a full `pnpm check` that passed on its own and passed with the
 * whole package**: an extra record with no `dedupKey` arrived ahead of the two this file causes, and
 * the assertions read the raw list. It is `@ramonda/devtools` — `diagnosticsReachUs` sends one
 * `debug` record with `scope: "ramonda/devtools"` through the global to check the sink still
 * round-trips, and `hub()` CHAINS a foreign sink rather than replacing it, so a collector installed
 * here receives it. That is the round-trip check working, not noise.
 *
 * So the list is filtered by scope rather than asserted whole, which is also what this file's own
 * note says it does: asserted over records this package really produced. `@ramonda/form` reached the
 * same answer from the same cause — see `Validation.test.tsx`.
 */
function ours(all: readonly RamondaDiagnostic[]): RamondaDiagnostic[] {
  return all.filter((record) => record.scope === "ramonda/query");
}

beforeEach(() => {
  records = [];
  resetKeyDiagnostics();
  globalThis.__RAMONDA_DIAGNOSTICS__ = (record) => records.push(record);
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errors.mockRestore();
  globalThis.__RAMONDA_DIAGNOSTICS__ = undefined;
});

describe("the diagnostic record", () => {
  test("RMQ001 arrives as a record, with the kind it found", () => {
    hashKey(["user", () => {}]);

    expect(ours(records)).toHaveLength(1);
    const record = ours(records)[0];

    expect(record.code).toBe("RMQ001");
    expect(record.scope).toBe("ramonda/query");
    expect(record.severity).toBe("error");
    expect(record.message).toContain("JSON.stringify drops");
    expect(record.fix).toContain("JSON-serializable");
    expect(record.data).toEqual({ kind: "function" });
    expect(record.time).toBeGreaterThan(1_700_000_000_000);
  });

  test("an unstable container is the same code with different data", () => {
    hashKey(["day", new Date()]);

    expect(ours(records)[0].code).toBe("RMQ001");
    expect(ours(records)[0].data).toEqual({ container: "Date" });
  });

  test("it publishes the dedup key it deduplicates on", () => {
    // A key is hashed on every render, so the grouping is not a nicety — and a collector that
    // dedupes has to collapse exactly what this package collapses, which is what the field is for.
    hashKey(["a", () => {}]);
    hashKey(["b", () => {}]);
    hashKey(["c", Symbol("s")]);

    expect(ours(records).map((r) => r.dedupKey)).toEqual(["RMQ001:function", "RMQ001:symbol"]);
    expect(errors).toHaveBeenCalledTimes(2);
  });

  test("every value in `data` is one a collector can hold for ever", () => {
    hashKey(["user", () => {}]);
    hashKey(["day", new Map()]);

    // A record lives in a bounded history. Anything live in it — a component, a DOM node, an
    // Error with its stack — keeps that alive for as long as the history does.
    for (const record of ours(records)) {
      for (const value of Object.values(record.data ?? {})) {
        expect(["string", "number", "boolean"]).toContain(typeof value);
      }
    }
  });

  /**
   * The defence itself, asserted rather than assumed.
   *
   * Without it this file failed inside a full `pnpm check` and passed every other way, which is the
   * worst shape a test can have — so the leak is planted here deliberately. The record below is the
   * exact one `@ramonda/devtools` sends: `debug`, its own scope, and no `dedupKey`.
   */
  test("a record another package put through the same global sink is not ours", () => {
    globalThis.__RAMONDA_DIAGNOSTICS__?.({
      code: "selftest",
      scope: "ramonda/devtools",
      severity: "debug",
      message: "diagnostics sink round-trip check",
      time: Date.now(),
    } as RamondaDiagnostic);
    hashKey(["user", () => {}]);

    expect(records).toHaveLength(2);
    expect(ours(records).map((record) => record.code)).toEqual(["RMQ001"]);
    expect(ours(records)[0].dedupKey).toBe("RMQ001:function");
  });

  test("the console still says it, with no collector installed", () => {
    globalThis.__RAMONDA_DIAGNOSTICS__ = undefined;
    hashKey(["user", () => {}]);

    expect(errors).toHaveBeenCalledTimes(1);
    expect(String(errors.mock.calls[0][0])).toContain("[Ramonda query RMQ001]");
    expect(ours(records)).toEqual([]);
  });
});
