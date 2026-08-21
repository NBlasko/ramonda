import { afterEach, describe, expect, test, vi } from "vitest";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIsrCache, fileStore, memoryStore, type IsrStore } from "../isr";

/**
 * The ISR cache decides between three answers — fresh, stale-while-revalidate, and cold — and
 * keeps the result in a store the app plugs in. Both halves are tested here: the policy against a
 * fake clock, and the two shipped stores against their real backing.
 */

const plan = { isr: [{ path: "/about", revalidate: 60 }] };

/** A clock the test moves by hand, so nothing here waits on real time. */
function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

const temps: string[] = [];
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ramonda-isr-"));
  temps.push(dir);
  return dir;
}
afterEach(async () => {
  for (const dir of temps.splice(0)) await rm(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("the three answers", () => {
  test("a path that is not an ISR route is not this cache's business", async () => {
    const isr = createIsrCache({ plan, store: memoryStore(), render: async () => "x" });
    // `undefined`, not a thrown error and not an empty page: the server falls through to its
    // own static or dynamic path.
    expect(await isr.serve("/hello/ada")).toBeUndefined();
  });

  test("cold renders inline, then hits the cache until the window passes", async () => {
    const time = clock();
    let baked = 0;
    const isr = createIsrCache({
      plan,
      store: memoryStore(),
      now: time.now,
      render: async () => `<p>bake ${++baked}</p>`,
    });

    expect(await isr.serve("/about")).toEqual({ html: "<p>bake 1</p>", mode: "isr-cold" });

    time.advance(59_000);
    expect(await isr.serve("/about")).toEqual({ html: "<p>bake 1</p>", mode: "isr-hit" });
    expect(baked).toBe(1);
  });

  test("past the window the STALE copy is served and the rebake happens behind it", async () => {
    const time = clock();
    let baked = 0;
    const isr = createIsrCache({
      plan,
      store: memoryStore(),
      now: time.now,
      render: async () => `<p>bake ${++baked}</p>`,
    });

    await isr.serve("/about");
    time.advance(61_000);

    // The visitor gets the old page immediately — that is the whole point of ISR.
    expect(await isr.serve("/about")).toEqual({ html: "<p>bake 1</p>", mode: "isr-stale" });

    await vi.waitFor(() => expect(baked).toBe(2));
    expect(await isr.serve("/about")).toEqual({ html: "<p>bake 2</p>", mode: "isr-hit" });
  });

  test("a background rebake that fails leaves the stale page serving", async () => {
    const time = clock();
    const onError = vi.fn();
    let calls = 0;
    const isr = createIsrCache({
      plan,
      store: memoryStore(),
      now: time.now,
      onError,
      render: async () => {
        calls++;
        if (calls > 1) throw new Error("upstream is down");
        return "<p>first</p>";
      },
    });

    await isr.serve("/about");
    time.advance(61_000);

    // Not a 500. The page is old, which is a smaller problem than no page.
    expect(await isr.serve("/about")).toEqual({ html: "<p>first</p>", mode: "isr-stale" });
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onError.mock.calls[0]?.[0]).toBe("/about");

    expect(await isr.serve("/about")).toEqual({ html: "<p>first</p>", mode: "isr-stale" });
  });

  test("a COLD render that fails throws, because there is nothing else to send", async () => {
    const isr = createIsrCache({
      plan,
      store: memoryStore(),
      render: async () => {
        throw new Error("upstream is down");
      },
    });

    await expect(isr.serve("/about")).rejects.toThrow("upstream is down");
  });
});

describe("one rebake, however many requests arrive during it", () => {
  test("concurrent stale requests do not stampede the renderer", async () => {
    const time = clock();
    let baked = 0;
    let gate = Promise.resolve();
    let releaseRender = () => {};

    const isr = createIsrCache({
      plan,
      store: memoryStore(),
      now: time.now,
      render: async () => {
        baked++;
        await gate;
        return `<p>bake ${baked}</p>`;
      },
    });

    await isr.serve("/about");
    expect(baked).toBe(1);

    // Hold the next render open, then let ten requests find the same stale entry.
    gate = new Promise<void>((resolve) => {
      releaseRender = resolve;
    });
    time.advance(61_000);
    const pages = await Promise.all(Array.from({ length: 10 }, () => isr.serve("/about")));

    // Without single-flight this is 11: every request that sees the stale entry starts its own
    // render, which is exactly the stampede a slow page under load produces.
    expect(baked).toBe(2);
    for (const page of pages) expect(page?.mode).toBe("isr-stale");

    releaseRender();
    await vi.waitFor(async () => expect((await isr.serve("/about"))?.mode).toBe("isr-hit"));
  });

  test("concurrent COLD requests share one render", async () => {
    let baked = 0;
    const isr = createIsrCache({
      plan,
      store: memoryStore(),
      render: async () => {
        baked++;
        await Promise.resolve();
        return "<p>once</p>";
      },
    });

    const pages = await Promise.all(Array.from({ length: 5 }, () => isr.serve("/about")));

    expect(baked).toBe(1);
    for (const page of pages) expect(page).toEqual({ html: "<p>once</p>", mode: "isr-cold" });
  });
});

describe("the store is what makes a second instance agree with the first", () => {
  test("two caches over ONE file store share the bake", async () => {
    const dir = await tempDir();
    const time = clock();
    let baked = 0;
    const make = () =>
      createIsrCache({
        plan,
        store: fileStore({ dir }),
        now: time.now,
        render: async () => `<p>bake ${++baked}</p>`,
      });

    const instanceA = make();
    const instanceB = make();

    expect(await instanceA.serve("/about")).toEqual({ html: "<p>bake 1</p>", mode: "isr-cold" });

    // This is the bug 5b existed for: with a per-process Map, B renders its own copy and the two
    // instances then age independently, so a visitor bounces between them.
    expect(await instanceB.serve("/about")).toEqual({ html: "<p>bake 1</p>", mode: "isr-hit" });
    expect(baked).toBe(1);
  });

  test("a file store survives the process that wrote it", async () => {
    const dir = await tempDir();
    await fileStore({ dir }).set("/about", { html: "<p>from a previous life</p>", at: 5 });

    // A fresh store object over the same directory — what a restart amounts to.
    expect(await fileStore({ dir }).get("/about")).toEqual({ html: "<p>from a previous life</p>", at: 5 });
  });

  test("a path becomes one flat file, slashes and all", async () => {
    const dir = await tempDir();
    await fileStore({ dir }).set("/blog/2026/hello", { html: "<p>x</p>", at: 1 });

    // Encoded rather than nested: no directories to create, and no path outside `dir` to reach.
    expect(await readdir(dir)).toEqual(["%2Fblog%2F2026%2Fhello.json"]);
  });

  test("a file that is missing, truncated or not JSON reads as a cold render", async () => {
    const dir = await tempDir();
    const store = fileStore({ dir });

    expect(await store.get("/never-written")).toBeUndefined();

    await store.set("/about", { html: "<p>x</p>", at: 1 });
    await writeFile(join(dir, "%2Fabout.json"), '{"html":"<p>tr', "utf8");
    // Not a throw and not a broken page: absent means "render it", which is always correct.
    expect(await store.get("/about")).toBeUndefined();

    await writeFile(join(dir, "%2Fabout.json"), '{"html":42,"at":"soon"}', "utf8");
    expect(await store.get("/about")).toBeUndefined();
  });

  test("a write leaves no temporary file behind", async () => {
    const dir = await tempDir();
    await fileStore({ dir }).set("/about", { html: "<p>x</p>", at: 1 });

    // The page is renamed into place, so a concurrent reader never sees half of one.
    expect((await readdir(dir)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  test("any three-method object is a store — that is the whole contract", async () => {
    const written: Array<[string, string]> = [];
    const dropped: string[] = [];
    const remote: IsrStore = {
      async get() {
        return undefined;
      },
      async set(key, entry) {
        written.push([key, entry.html]);
      },
      // Third since a `:param` route became cacheable: one route, as many pages as there are items,
      // so the cache has to be able to give one back.
      async delete(key) {
        dropped.push(key);
      },
    };

    const isr = createIsrCache({ plan, store: remote, render: async () => "<p>from redis, say</p>" });
    await isr.serve("/about");

    expect(written).toEqual([["/about", "<p>from redis, say</p>"]]);
  });
});

/**
 * A route with a `:param` — one route, as many pages as there are items.
 *
 * It was accepted and did nothing: `plan.isr` carried the PATTERN and the window map was keyed by that
 * string, so `serve("/products/7")` looked up `/products/7`, found no window, and returned `undefined`.
 * The caller then fell through to its dynamic branch and rendered per request with the real request
 * context — the opposite of what `revalidate` asks for, and silent.
 */
describe("an ISR route that takes a param", () => {
  const products = { isr: [{ path: "/products/:id", revalidate: 60 }] };

  test("a request for one of its pages is this cache's business", async () => {
    const time = clock();
    const baked: string[] = [];
    const isr = createIsrCache({
      plan: products,
      store: memoryStore(),
      maxPages: 10,
      render: async (path) => {
        baked.push(path);
        return `<p>${path}</p>`;
      },
      now: time.now,
    });

    const cold = await isr.serve("/products/7");
    expect(cold).toEqual({ html: "<p>/products/7</p>", mode: "isr-cold" });

    // Cached under the PATH, not the pattern, so a second product is its own page.
    expect((await isr.serve("/products/7"))?.mode).toBe("isr-hit");
    expect((await isr.serve("/products/9"))?.mode).toBe("isr-cold");
    expect(baked).toEqual(["/products/7", "/products/9"]);

    // And the window is the route's: past it, the next request serves stale and rebakes.
    time.advance(61_000);
    expect((await isr.serve("/products/7"))?.mode).toBe("isr-stale");
  });

  test("a literal route wins over a pattern that would also match", async () => {
    const time = clock();
    const isr = createIsrCache({
      // `/products/new` first, the way a table declares the specific one before the general.
      plan: {
        isr: [
          { path: "/products/new", revalidate: 5 },
          { path: "/products/:id", revalidate: 600 },
        ],
      },
      store: memoryStore(),
      maxPages: 10,
      render: async (path) => path,
      now: time.now,
    });

    await isr.serve("/products/new");
    // The literal route's window is 5s. If the pattern had answered, this would still be fresh at 10s.
    time.advance(10_000);
    expect((await isr.serve("/products/new"))?.mode).toBe("isr-stale");
  });

  /**
   * The cap is required for these routes and refused for the others, because a number that bounds
   * nothing is a number somebody will trust.
   */
  test("`maxPages` is required, and refused when there is nothing to bound", async () => {
    expect(() => createIsrCache({ plan: products, store: memoryStore(), render: async () => "x" })).toThrow(
      /`\/products\/:id` is an ISR route that takes a `:param`.*pass `maxPages`/s,
    );
    expect(() =>
      createIsrCache({ plan: products, store: memoryStore(), maxPages: 0, render: async () => "x" }),
    ).toThrow(/pass `maxPages`/);
    expect(() => createIsrCache({ plan, store: memoryStore(), maxPages: 10, render: async () => "x" })).toThrow(
      /no ISR route takes a `:param`.*Remove it/s,
    );
  });
});

/**
 * The bound, and it is least RECENTLY used rather than least often — see `maxPages` for why counting
 * hits does the opposite of what it looks like.
 */
describe("the page cap", () => {
  const products = { isr: [{ path: "/products/:id", revalidate: 60 }] };

  const bounded = (maxPages: number, dropped: string[]) => {
    const entries = new Map<string, { html: string; at: number }>();
    const store: IsrStore = {
      async get(key) {
        return entries.get(key);
      },
      async set(key, entry) {
        entries.set(key, entry);
      },
      async delete(key) {
        dropped.push(key);
        entries.delete(key);
      },
    };
    return {
      entries,
      isr: createIsrCache({ plan: products, store, maxPages, render: async (path) => path }),
    };
  };

  test("a third page past a cap of two drops the one nobody asked for longest", async () => {
    const dropped: string[] = [];
    const { entries, isr } = bounded(2, dropped);

    await isr.serve("/products/1");
    await isr.serve("/products/2");
    expect(dropped).toEqual([]);

    await isr.serve("/products/3");
    expect(dropped).toEqual(["/products/1"]);
    expect([...entries.keys()]).toEqual(["/products/2", "/products/3"]);
  });

  /**
   * The half that makes it RECENCY: asking for a page again saves it, which is what counting hits
   * cannot do for a page that is new.
   */
  test("asking for a page again moves it out of the way of the eviction", async () => {
    const dropped: string[] = [];
    const { isr } = bounded(2, dropped);

    await isr.serve("/products/1");
    await isr.serve("/products/2");
    // 1 is wanted again, so 2 becomes the one nobody has asked for longest.
    expect((await isr.serve("/products/1"))?.mode).toBe("isr-hit");

    await isr.serve("/products/3");
    expect(dropped).toEqual(["/products/2"]);
  });

  test("a cache that never exceeds the cap drops nothing", async () => {
    const dropped: string[] = [];
    const { isr } = bounded(3, dropped);

    for (const id of [1, 2, 3, 1, 2, 3]) await isr.serve(`/products/${id}`);
    expect(dropped).toEqual([]);
  });
});

/**
 * Three ways the bookkeeping was wrong, each found by review and each measured before the fix.
 *
 * The cap is only as good as the count behind it, and the count is a map this process keeps beside a
 * store it does not own. All three faults were the same shape: the map saying something the store does
 * not.
 */
describe("what the cap counts", () => {
  const products = { isr: [{ path: "/products/:id", revalidate: 60 }] };

  const seeded = (maxPages: number, seed: string[] = [], failOn?: string) => {
    const entries = new Map<string, { html: string; at: number }>();
    for (const path of seed) entries.set(path, { html: path, at: 1_000_000 });
    const dropped: string[] = [];
    const errors: string[] = [];
    const store: IsrStore = {
      async get(key) {
        return entries.get(key);
      },
      async set(key, entry) {
        entries.set(key, entry);
      },
      async delete(key) {
        if (key === failOn) throw new Error("the store is down");
        dropped.push(key);
        entries.delete(key);
      },
    };
    return {
      entries,
      dropped,
      errors,
      isr: createIsrCache({
        plan: products,
        store,
        maxPages,
        render: async (path) => {
          if (path.endsWith("/boom")) throw new Error("render failed");
          return path;
        },
        onError: (_path, error) => errors.push(String(error)),
        now: () => 1_000_000,
      }),
    };
  };

  /**
   * A render that REJECTED used to leave a key behind with nothing under it, and the cap then counted
   * the phantom: measured, one failure made the next success drop BOTH live pages from a cache of two.
   */
  test("a failed render costs no live page", async () => {
    const { entries, dropped, isr } = seeded(2);

    await isr.serve("/products/1");
    await isr.serve("/products/2");
    await expect(isr.serve("/products/boom")).rejects.toThrow("render failed");

    await isr.serve("/products/3");
    // One eviction, not two, and the two survivors are the two most recently wanted.
    expect(dropped).toEqual(["/products/1"]);
    expect([...entries.keys()].sort()).toEqual(["/products/2", "/products/3"]);
  });

  /**
   * A store this process did not fill — a `fileStore` directory after a restart — used to be
   * unbounded, because the trim only ran after a bake and every answer was a hit.
   */
  test("a store that was already full is brought under the cap by serving it", async () => {
    const seed = ["/products/1", "/products/2", "/products/3", "/products/4", "/products/5"];
    const { entries, isr } = seeded(2, seed);
    expect(entries.size).toBe(5);

    for (const path of seed) expect((await isr.serve(path))?.mode).toBe("isr-hit");

    expect(entries.size).toBe(2);
    // The last two asked for, which is what recency means.
    expect([...entries.keys()].sort()).toEqual(["/products/4", "/products/5"]);
  });

  /**
   * `fileStore.delete` swallows everything, but `IsrStore` is an interface an app implements and its
   * contract only promises that a missing key is not an error. A store that is down must not turn a
   * page that rendered into a 500.
   */
  /**
   * The STALE branch trims too, and it is here because planting found it uncovered: the first three
   * tests reach only the hit and cold paths, so removing the trim from this one changed nothing they
   * could see.
   */
  test("a stale answer trims as well, so a rebake cannot be the only thing that bounds it", async () => {
    const entries = new Map<string, { html: string; at: number }>();
    for (const path of ["/products/1", "/products/2", "/products/3"]) entries.set(path, { html: path, at: 0 });
    const dropped: string[] = [];
    const store: IsrStore = {
      async get(key) {
        return entries.get(key);
      },
      async set(key, entry) {
        entries.set(key, entry);
      },
      async delete(key) {
        dropped.push(key);
        entries.delete(key);
      },
    };
    // `at: 0` against a clock at 1_000_000 — every entry is past its window, so every answer is stale.
    const isr = createIsrCache({
      plan: products,
      store,
      maxPages: 1,
      render: async (path) => path,
      now: () => 1_000_000,
    });

    expect((await isr.serve("/products/1"))?.mode).toBe("isr-stale");
    expect((await isr.serve("/products/2"))?.mode).toBe("isr-stale");

    // Trimmed down to one on the stale path, without waiting for a bake to finish.
    expect(dropped.length).toBeGreaterThan(0);
    expect(entries.has("/products/2")).toBe(true);
  });

  /** And the guard is on every path, not only the cold one — same reason: planting found it uncovered. */
  test("an eviction that throws on a HIT does not fail the hit", async () => {
    const entries = new Map<string, { html: string; at: number }>();
    for (const path of ["/products/1", "/products/2"]) entries.set(path, { html: path, at: 1_000_000 });
    const errors: string[] = [];
    const store: IsrStore = {
      async get(key) {
        return entries.get(key);
      },
      async set(key, entry) {
        entries.set(key, entry);
      },
      async delete() {
        throw new Error("the store is down");
      },
    };
    const isr = createIsrCache({
      plan: products,
      store,
      maxPages: 1,
      render: async (path) => path,
      onError: (_path, error) => errors.push(String(error)),
      now: () => 1_000_000,
    });

    expect((await isr.serve("/products/1"))?.mode).toBe("isr-hit");
    const second = await isr.serve("/products/2");

    expect(second).toEqual({ html: "/products/2", mode: "isr-hit" });
    expect(errors.join()).toContain("the store is down");
  });

  test("an eviction that cannot happen is reported, not raised", async () => {
    const { entries, errors, isr } = seeded(1, [], "/products/1");

    expect((await isr.serve("/products/1"))?.mode).toBe("isr-cold");
    // Over the cap now, and the delete of `/products/1` throws.
    const second = await isr.serve("/products/2");

    expect(second?.mode).toBe("isr-cold");
    expect(second?.html).toBe("/products/2");
    expect(errors.join()).toContain("the store is down");
    // The page that could not be dropped is still there, which is a cache one entry too large —
    // tried again on the next request, and not a page the visitor failed to get.
    expect(entries.has("/products/2")).toBe(true);
  });
});
