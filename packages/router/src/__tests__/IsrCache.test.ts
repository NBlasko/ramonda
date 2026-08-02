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

  test("any two-method object is a store — that is the whole contract", async () => {
    const written: Array<[string, string]> = [];
    const remote: IsrStore = {
      async get() {
        return undefined;
      },
      async set(key, entry) {
        written.push([key, entry.html]);
      },
    };

    const isr = createIsrCache({ plan, store: remote, render: async () => "<p>from redis, say</p>" });
    await isr.serve("/about");

    expect(written).toEqual([["/about", "<p>from redis, say</p>"]]);
  });
});
