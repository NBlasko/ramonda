import { describe, expect, test, vi } from "vitest";
import { QueryClient } from "../QueryClient";
import type { QueryEvent } from "../types";
import { ServerQueryError } from "../errors";

/** A clock the test moves by hand — see `QueryClientOptions.now`. */
function clock(start = 1000) {
  let value = start;
  return {
    now: () => value,
    advance(ms: number) {
      value += ms;
    },
  };
}

/** A fetcher that resolves when the test says so. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("fetching", () => {
  test("data lands on the entry and observers are woken", async () => {
    const client = new QueryClient();
    const events: QueryEvent[] = [];
    client.subscribe(["user", 1], (event) => events.push(event));

    await client.fetch(["user", 1], async () => ({ name: "ada" }));

    const entry = client.peek<{ name: string }>(["user", 1])!;
    expect(entry.status).toBe("success");
    expect(entry.data).toEqual({ name: "ada" });
    expect(entry.fetchStatus).toBe("idle");
    // One for entering "fetching", one for the data.
    expect(events).toEqual(["updated", "updated"]);
  });

  test("two callers of the same key share one request", async () => {
    const client = new QueryClient();
    const fetcher = vi.fn(async () => "once");

    await Promise.all([client.fetch(["k"], fetcher), client.fetch(["k"], fetcher)]);

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test("a fetch in flight is reported as fetching while it runs", async () => {
    const client = new QueryClient();
    const gate = deferred<string>();

    const running = client.fetch(["k"], () => gate.promise);
    expect(client.peek(["k"])!.fetchStatus).toBe("fetching");
    expect(client.peek(["k"])!.status).toBe("pending");

    gate.resolve("done");
    await running;
    expect(client.peek(["k"])!.fetchStatus).toBe("idle");
  });

  test("the fetcher is handed the key and a signal", async () => {
    const client = new QueryClient();
    const seen: unknown[] = [];

    await client.fetch(["user", 7], async (ctx) => {
      seen.push(ctx.key, ctx.signal instanceof AbortSignal);
      return null;
    });

    expect(seen).toEqual([["user", 7], true]);
  });
});

describe("failure", () => {
  test("a failed query keeps its last known data", async () => {
    const client = new QueryClient({ defaults: { retry: 0 } });
    await client.fetch(["k"], async () => "first");
    client.invalidate(["k"]);
    await client.fetch(["k"], async () => {
      throw new Error("network");
    });

    const entry = client.peek(["k"])!;
    expect(entry.status).toBe("error");
    expect((entry.error as Error).message).toBe("network");
    // Blanking the page to prove the network failed would serve nobody.
    expect(entry.data).toBe("first");
  });

  test("retries are counted, then it gives up", async () => {
    const client = new QueryClient({ defaults: { retry: 2, retryDelay: 0 } });
    const fetcher = vi.fn(async () => {
      throw new Error("nope");
    });

    await client.fetch(["k"], fetcher);

    // The first attempt plus two retries.
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(client.peek(["k"])!.status).toBe("error");
    expect(client.peek(["k"])!.failureCount).toBe(3);
  });

  test("a retry predicate decides per failure", async () => {
    const client = new QueryClient({
      defaults: {
        retryDelay: 0,
        // The shape an HTTP client wants: a 404 will never succeed on attempt three.
        retry: (_count, error) => (error as Error).message !== "404",
      },
    });
    const fetcher = vi.fn(async () => {
      throw new Error("404");
    });

    await client.fetch(["k"], fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test("a retry that succeeds clears the failure", async () => {
    const client = new QueryClient({ defaults: { retry: 3, retryDelay: 0 } });
    let attempts = 0;
    await client.fetch(["k"], async () => {
      if (++attempts < 3) throw new Error("flaky");
      return "eventually";
    });

    const entry = client.peek(["k"])!;
    expect(entry.status).toBe("success");
    expect(entry.data).toBe("eventually");
    expect(entry.failureCount).toBe(0);
    expect(entry.error).toBeUndefined();
  });
});

describe("races", () => {
  test("a cancelled fetch never applies its result", async () => {
    const client = new QueryClient();
    const gate = deferred<string>();

    const running = client.fetch(["k"], () => gate.promise);
    client.cancel(["k"]);
    gate.resolve("too late");
    await running;

    const entry = client.peek(["k"])!;
    expect(entry.status).toBe("pending");
    expect(entry.data).toBeUndefined();
    // The abort must not be committed as the query's error either.
    expect(entry.error).toBeUndefined();
  });

  test("setData wins over a fetch already in flight", async () => {
    const client = new QueryClient();
    const gate = deferred<string>();

    const running = client.fetch(["k"], () => gate.promise);
    client.setData(["k"], "written");
    gate.resolve("from the network");
    await running;

    expect(client.peek(["k"])!.data).toBe("written");
  });

  test("the abort signal is raised so the fetcher can stop", async () => {
    const client = new QueryClient();
    let aborted = false;

    const running = client.fetch(["k"], (ctx) => {
      ctx.signal.addEventListener("abort", () => {
        aborted = true;
      });
      return deferred<string>().promise;
    });
    client.cancel(["k"]);
    // The promise the caller holds settles even though the fetcher never does:
    // `run` returns as soon as it sees itself superseded.
    await Promise.race([running, Promise.resolve()]);

    expect(aborted).toBe(true);
  });

  test("a fetch superseded mid-retry stops retrying", async () => {
    const client = new QueryClient({ defaults: { retry: 5, retryDelay: 50 } });
    const fetcher = vi.fn(async () => {
      throw new Error("nope");
    });

    const running = client.fetch(["k"], fetcher);
    await Promise.resolve();
    client.cancel(["k"]);
    await running;

    // The first attempt happened; the backoff was cut short rather than firing
    // four more requests for a page nobody is looking at.
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("staleness", () => {
  test("data is stale once staleTime has passed", async () => {
    const time = clock();
    const client = new QueryClient({ now: time.now, defaults: { staleTime: 1000 } });
    await client.fetch(["k"], async () => "v");

    expect(client.isStale(["k"], 1000)).toBe(false);
    time.advance(999);
    expect(client.isStale(["k"], 1000)).toBe(false);
    time.advance(1);
    expect(client.isStale(["k"], 1000)).toBe(true);
  });

  test("an entry with no data is always stale, even at staleTime: Infinity", () => {
    const client = new QueryClient();
    expect(client.isStale(["never-fetched"], Number.POSITIVE_INFINITY)).toBe(true);
  });

  test("prefetch skips a key that is still fresh", async () => {
    const time = clock();
    const client = new QueryClient({ now: time.now, defaults: { staleTime: 1000 } });
    const fetcher = vi.fn(async () => "v");

    await client.prefetch(["k"], fetcher);
    await client.prefetch(["k"], fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);

    time.advance(1000);
    await client.prefetch(["k"], fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  test("invalidate marks stale and asks observers to refetch", async () => {
    const client = new QueryClient({ defaults: { staleTime: Number.POSITIVE_INFINITY } });
    await client.fetch(["user", 1], async () => "a");
    await client.fetch(["posts", 1], async () => "b");

    const events: QueryEvent[] = [];
    client.subscribe(["user", 1], (event) => events.push(event));
    const other: QueryEvent[] = [];
    client.subscribe(["posts", 1], (event) => other.push(event));

    client.invalidate(["user"]);

    expect(events).toEqual(["invalidated"]);
    expect(other).toEqual([]);
    // Stale, but the data stays on screen while the refetch runs.
    expect(client.peek(["user", 1])!.data).toBe("a");
    expect(client.isStale(["user", 1], Number.POSITIVE_INFINITY)).toBe(true);
  });

  test("invalidate with no prefix reaches everything", async () => {
    const client = new QueryClient();
    await client.fetch(["a"], async () => 1);
    await client.fetch(["b"], async () => 2);

    const woken: string[] = [];
    client.subscribe(["a"], () => woken.push("a"));
    client.subscribe(["b"], () => woken.push("b"));
    client.invalidate();

    expect(woken.sort()).toEqual(["a", "b"]);
  });
});

describe("observers and collection", () => {
  test("unsubscribing twice does not un-count an observer that never left", () => {
    const client = new QueryClient();
    const first = client.subscribe(["k"], () => {});
    const second = client.subscribe(["k"], () => {});

    first();
    first();

    expect(client.peek(["k"])!.observers.size).toBe(1);
    second();
    expect(client.peek(["k"])!.observers.size).toBe(0);
  });

  test("an unwatched entry is dropped once gcTime has passed", async () => {
    const time = clock();
    const client = new QueryClient({ now: time.now, defaults: { gcTime: 1000 } });
    const unsubscribe = client.subscribe(["k"], () => {});
    await client.fetch(["k"], async () => "v");

    unsubscribe();
    expect(client.peek(["k"])).toBeDefined();

    time.advance(1000);
    // The sweep runs on the way past, not from a timer — so something has to walk
    // past. A new observer arriving is one such moment.
    client.subscribe(["other"], () => {});
    expect(client.peek(["k"])).toBeUndefined();
  });

  test("a watched entry is never collected", async () => {
    const time = clock();
    const client = new QueryClient({ now: time.now, defaults: { gcTime: 1000 } });
    client.subscribe(["k"], () => {});
    await client.fetch(["k"], async () => "v");

    time.advance(10_000);
    client.sweep();
    expect(client.peek(["k"])).toBeDefined();
  });

  test("losing the last observer abandons the request nobody is waiting for", async () => {
    const client = new QueryClient();
    let aborted = false;
    const unsubscribe = client.subscribe(["k"], () => {});

    const running = client.fetch(["k"], (ctx) => {
      ctx.signal.addEventListener("abort", () => {
        aborted = true;
      });
      return deferred<string>().promise;
    });

    unsubscribe();
    await Promise.race([running, Promise.resolve()]);
    expect(aborted).toBe(true);
  });

  test("gcTime comes from the query's own options, not the client default", async () => {
    const time = clock();
    const client = new QueryClient({ now: time.now, defaults: { gcTime: 1000 } });
    const unsubscribe = client.subscribe(["kept"], () => {});
    await client.fetch(["kept"], async () => "v", { gcTime: 10_000 });
    unsubscribe();

    time.advance(1000);
    client.sweep();
    expect(client.peek(["kept"])).toBeDefined();

    time.advance(9000);
    client.sweep();
    expect(client.peek(["kept"])).toBeUndefined();
  });
});

describe("setData and remove", () => {
  test("the updater form receives what is there now", async () => {
    const client = new QueryClient();
    await client.fetch(["n"], async () => 1);
    client.setData<number>(["n"], (previous) => (previous ?? 0) + 1);
    expect(client.peek(["n"])!.data).toBe(2);
  });

  test("setData on a key never fetched starts from undefined", () => {
    const client = new QueryClient();
    client.setData<string[]>(["list"], (previous) => [...(previous ?? []), "first"]);
    expect(client.peek(["list"])!.data).toEqual(["first"]);
    expect(client.peek(["list"])!.status).toBe("success");
  });

  test("remove drops a prefix and leaves the rest", async () => {
    const client = new QueryClient();
    await client.fetch(["user", 1], async () => "a");
    await client.fetch(["posts", 1], async () => "b");

    client.remove(["user"]);
    expect(client.peek(["user", 1])).toBeUndefined();
    expect(client.peek(["posts", 1])).toBeDefined();
  });
});

describe("dehydrate and hydrate", () => {
  test("a successful query crosses the boundary", async () => {
    const server = new QueryClient();
    await server.fetch(["user", 1], async () => ({ name: "ada" }));

    const client = new QueryClient();
    client.hydrate(JSON.parse(JSON.stringify(server.dehydrate())));

    const entry = client.peek<{ name: string }>(["user", 1])!;
    expect(entry.data).toEqual({ name: "ada" });
    expect(entry.status).toBe("success");
    expect(entry.restored).toBe(true);
  });

  test("a failure crosses as a real Error, not an empty object", async () => {
    const server = new QueryClient({ defaults: { retry: 0 } });
    await server.fetch(["k"], async () => {
      throw new TypeError("bad json");
    });

    const client = new QueryClient();
    client.hydrate(JSON.parse(JSON.stringify(server.dehydrate())));

    const error = client.peek(["k"])!.error;
    // `JSON.stringify(new Error("x"))` is `{}` — name and message are
    // non-enumerable — so this is the whole reason errors are serialized by hand.
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ServerQueryError);
    expect((error as Error).message).toBe("bad json");
    expect((error as Error).name).toBe("TypeError");
  });

  test("a pending query is not carried over", () => {
    const server = new QueryClient();
    void server.fetch(["k"], () => deferred<string>().promise);
    expect(server.dehydrate().queries).toEqual([]);
  });

  test("updatedAt is restamped with this side's clock", async () => {
    const serverTime = clock(1_000_000);
    const server = new QueryClient({ now: serverTime.now });
    await server.fetch(["k"], async () => "v");

    // A client whose clock is far behind the server's — routine, and the reason
    // the server's timestamp is not trusted.
    const clientTime = clock(50);
    const client = new QueryClient({ now: clientTime.now });
    client.hydrate(server.dehydrate());

    expect(client.peek(["k"])!.updatedAt).toBe(50);
    // Fresh as of now, rather than a million milliseconds in the future.
    expect(client.isStale(["k"], 1000)).toBe(false);
  });

  test("data the client already fetched is not overwritten by the snapshot", async () => {
    const server = new QueryClient();
    await server.fetch(["k"], async () => "from the server");

    const client = new QueryClient();
    await client.fetch(["k"], async () => "fetched here");
    client.hydrate(server.dehydrate());

    expect(client.peek(["k"])!.data).toBe("fetched here");
  });
});
