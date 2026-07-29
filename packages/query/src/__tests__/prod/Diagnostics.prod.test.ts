import { describe, expect, test, vi } from "vitest";
import { hashKey, keyStartsWith } from "../../hashKey";
import { QueryClient } from "../../QueryClient";

/**
 * The production run: what RMQ001 gates must still WORK with `__DEV__` false.
 *
 * That the string is absent from `dist/index.prod.js` was checked by hand with a
 * grep. A grep proves a string is gone; it does not prove the code still behaves —
 * and hashing is the one thing every lookup depends on, including the hydration
 * lookup that has to agree with a hash produced on the server, in another process,
 * under a different build.
 *
 * See `vitest.prod.config.ts` for why this is a separate process.
 */

describe("production build", () => {
  test("an ignored failure is reported by nothing", async () => {
    /**
     * RMQ002's whole body is behind `__DEV__`, so here it must not even look. Behaviour is
     * what this run can check: that the string is absent from a production BUNDLE is a build
     * property, and `apps/docs`' production-build test greps every emitted chunk for
     * `RM[DQ]\d{3}` to prove it.
     */
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { QueryClient } = await import("../../QueryClient");
      const client = new QueryClient();
      await client.fetch(
        ["boom"],
        async () => {
          throw new Error("no");
        },
        { retry: 0 },
      );

      expect(client.peek(["boom"])!.status).toBe("error");
      expect(errors).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
  });

  test("the devtools bridge is not installed", async () => {
    // The registration is behind `__DEV__` inside QueryClientProvider, so importing the
    // package must not put anything on the global — a production page has no panel, and a
    // reachable registry would hold every cache the session built.
    await import("../../context");
    expect((globalThis as { __RAMONDA_QUERY__?: unknown }).__RAMONDA_QUERY__).toBeUndefined();
  });

  test("__DEV__ is false in this run", () => {
    // Without this the rest of the file would be testing the development path again.
    expect(__DEV__).toBe(false);
  });

  test("an unstable key is hashed silently — no report, and no throw", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      // In development each of these is RMQ001. Here the diagnostic does not exist,
      // and the deliberate choice is to hash anyway: on a live page a wrong render
      // beats a thrown one.
      expect(() => hashKey(["user", () => 1])).not.toThrow();
      expect(() => hashKey(["day", new Date(0)])).not.toThrow();
      expect(errors).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
  });

  test("hashing still agrees with itself, and sorts object keys", () => {
    expect(hashKey(["user", 1])).toBe(hashKey(["user", 1]));
    expect(hashKey(["posts", { page: 1, tag: "a" }])).toBe(hashKey(["posts", { tag: "a", page: 1 }]));
    expect(hashKey(["user", 1])).not.toBe(hashKey(["user", 2]));
    // The sentinel that keeps `undefined` from colliding with `null` is not a DEV
    // affordance — a production cache must tell those two questions apart too.
    expect(hashKey([undefined])).not.toBe(hashKey([null]));
  });

  test("prefix matching still works", () => {
    expect(keyStartsWith(["user", 1], ["user"])).toBe(true);
    expect(keyStartsWith(["posts", { page: 1 }], ["posts", { page: 1 }])).toBe(true);
    expect(keyStartsWith(["posts", 1], ["user"])).toBe(false);
  });

  test("the cache still dedupes, fetches and invalidates", async () => {
    const client = new QueryClient();
    const fetcher = vi.fn(async () => "v");

    await Promise.all([client.fetch(["k"], fetcher), client.fetch(["k"], fetcher)]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(client.peek(["k"])!.data).toBe("v");

    client.invalidate(["k"]);
    expect(client.isStale(["k"], 1000)).toBe(true);
  });
});
