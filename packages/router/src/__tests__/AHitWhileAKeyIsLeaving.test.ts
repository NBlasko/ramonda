import { describe, expect, test } from "vitest";
import { createIsrCache, memoryStore, type IsrStore } from "../isr";

/**
 * `serve`'s two `touch` calls, with the `leaving` set in view — the one part of the module a review
 * had not seen in its current form.
 *
 * `touch` records recency and deliberately does NOT uncondemn: a read stores nothing, so a key on
 * its way out stays on its way out. That is easy to state and hard to be sure of, because the window
 * it describes is a real one — a `store.delete` is in flight, the entry is still there, and a
 * request for exactly that page arrives.
 *
 * What could go wrong is not the answer to that request. It is the BOOKKEEPING afterwards: a key
 * touched into `held` and then deleted from the store, without being removed from `held`, is a
 * phantom — a name the cap counts with nothing behind it. The cost of one is a live page evicted
 * early, and the same fault was measured before on a different path, where a cold render that
 * rejected left a key in `held` and one failure cost a live slot at every later trim.
 *
 * So the assertion that matters is the last one: after the window, adding a page evicts exactly one.
 */
const products = { isr: [{ path: "/p/:id", revalidate: 60 }] };

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

/**
 * A store whose FIRST delete can be held open, so a request can arrive mid-eviction.
 *
 * Only the first, deliberately. A store that pauses every delete turns each later eviction into
 * another open gate, and the assertions end up measuring how many times the test remembered to
 * release rather than what the cache did — which is how the first reading of the stale case came
 * out with a page still present after its delete had been called.
 */
function pausableStore(): IsrStore & { release: () => void; deletes: string[] } {
  const inner = memoryStore();
  let gate: (() => void) | null = null;
  let armed = true;
  const state = {
    deletes: [] as string[],
    release: () => {
      gate?.();
      gate = null;
    },
    get: inner.get.bind(inner),
    set: inner.set.bind(inner),
    async delete(key: string) {
      state.deletes.push(key);
      if (armed) {
        armed = false;
        await new Promise<void>((resolve) => {
          gate = resolve;
        });
      }
      return inner.delete(key);
    },
  };
  return state as never;
}

/** Let the microtask queue drain, which is where an in-flight eviction lives. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("a request arriving while its page is being evicted", () => {
  test("is served, and leaves the count exactly as it found it", async () => {
    const time = clock();
    const store = pausableStore();
    const isr = createIsrCache({
      plan: products,
      store,
      maxPages: 2,
      render: async (path) => `<p>${path}</p>`,
      now: time.now,
    });

    await isr.serve("/p/1");
    await isr.serve("/p/2");

    // A third page puts the cache over its cap, so the oldest is condemned and its delete begins.
    const third = isr.serve("/p/3");
    await tick();
    expect(store.deletes).toEqual(["/p/1"]);

    // The delete has not landed, so the entry is still there and this is a real hit — not a
    // half-deleted page, and not a cold render of something the store still holds.
    expect((await isr.serve("/p/1"))?.mode).toBe("isr-hit");

    store.release();
    await third;
    await tick();

    expect({
      one: (await store.get("/p/1")) !== undefined,
      two: (await store.get("/p/2")) !== undefined,
      three: (await store.get("/p/3")) !== undefined,
    }).toEqual({ one: false, two: true, three: true });

    /**
     * And the count is honest. A phantom `/p/1` would be counted here, so the fourth page would put
     * the cache two over its cap and take a LIVE page with it — `/p/2` and then `/p/3`, leaving one
     * page in a cache allowed two.
     */
    const fourth = isr.serve("/p/4");
    await fourth;
    await tick();

    expect(store.deletes).toEqual(["/p/1", "/p/2"]);
    expect({
      two: (await store.get("/p/2")) !== undefined,
      three: (await store.get("/p/3")) !== undefined,
      four: (await store.get("/p/4")) !== undefined,
    }).toEqual({ two: false, three: true, four: true });
  });

  /**
   * The other `touch`, on the stale path — and it costs more than the note about it says.
   *
   * A stale page is still a page the store holds, so the same window exists. What is different is
   * that serving it starts a REBAKE, and here the rebake lands inside the eviction: measured, the
   * store is written a fourth time (`/p/1` again) and holds the page, and then the delete that was
   * already in flight removes what the rebake had just put there. That much was known and is
   * accepted — an entry lost, re-rendered on the next request, never a wrong page.
   *
   * What was NOT written down is the second half. The write uncondemned the key, so it stays in the
   * count while the store no longer has it — and the next insert is two over the cap instead of one.
   * It evicts twice, and the second one is a LIVE page: the cache ends holding a single page under a
   * cap of two. It heals, because a later trim reaches the phantom and drops it, but the healing
   * costs a page that had done nothing wrong.
   *
   * Written down as the cost it is. Fixing it needs compare-and-set in `IsrStore`, which turns three
   * unconditional methods into an interface most stores cannot satisfy — which is why it is a test
   * and not a patch.
   */
  test("a rebake landing inside its own eviction costs a live page as well", async () => {
    const time = clock();
    const store = pausableStore();
    const isr = createIsrCache({
      plan: products,
      store,
      maxPages: 2,
      render: async (path) => `<p>${path}</p>`,
      now: time.now,
    });

    await isr.serve("/p/1");
    await isr.serve("/p/2");
    time.advance(61_000);

    const third = isr.serve("/p/3");
    await tick();
    expect(store.deletes).toEqual(["/p/1"]);

    // Stale, so this serves the old page AND starts a rebake while the delete is still in flight.
    expect((await isr.serve("/p/1"))?.mode).toBe("isr-stale");
    await tick();
    await tick();

    // The rebake has written it back, and the store holds it — for now.
    expect((await store.get("/p/1")) !== undefined).toBe(true);

    store.release();
    await third;
    await tick();
    await tick();

    // The delete lands on what the rebake wrote. This is the known half.
    expect((await store.get("/p/1")) !== undefined).toBe(false);

    // The half that was not written down: the key stayed in the count, so this insert is two over
    // the cap and takes a live page with it.
    await isr.serve("/p/4");
    await tick();

    expect(store.deletes).toEqual(["/p/1", "/p/2", "/p/3"]);
    expect({
      two: (await store.get("/p/2")) !== undefined,
      three: (await store.get("/p/3")) !== undefined,
      four: (await store.get("/p/4")) !== undefined,
    }).toEqual({ two: false, three: false, four: true });
  });
});
