import { describe, test, expect } from "vitest";
import { getDOM } from "../../test/setup";
import { Component } from "../../base/Component";
import { Hook } from "../../base/Hook";
import { compute, state } from "../../base/decorators";

/**
 * A hook's props bag is rebuilt when — and only when — a signal the callback read has moved.
 * The callback is cached on those signals, the way `@compute` is cached on the ones its getter
 * reads. See `helpers/common.ts` for why.
 *
 * This file used to open by saying the bag is rebuilt on EVERY render of the owner, and its four
 * tests pinned down the two ways an app could make the contents stable anyway: hold the whole bag
 * in a `@compute`, or pass a bound method instead of a closure. Both still work and both are still
 * here — what changed is that they are no longer the thing standing between a natural callback and
 * a hook that recomputes for nothing. The framework does that part now.
 *
 * What the two forms are still FOR is the render where the callback does run: the cache stops the
 * call, it does not make a rebuilt array inside a call that had to happen equal to the last one.
 * The third test is that case, and it is the one `@StableProps` exists for.
 */

interface Bag {
  items: readonly number[];
  load: () => number;
}

class Reader extends Hook<Bag> {
  get seen(): number {
    return this.props.items.length + this.props.load();
  }
}

describe("stabilising a hook's props", () => {
  test("a callback that reads no signal is called once, and its bag never moves again", async () => {
    const bags: unknown[] = [];
    const arrays: unknown[] = [];

    class Panel extends Component {
      @state tick = 0;
      reader = this.use(Reader, (self: Panel) => {
        const bag = { items: [1, 2, 3], load: () => self.tick };
        bags.push(bag);
        arrays.push(bag.items);
        return bag;
      });

      render() {
        return <div>{String(this.reader.seen)}</div>;
      }
    }

    const { instance, settle } = await getDOM<Panel>(<Panel />);
    instance.tick = 1;
    await settle();
    instance.tick = 2;
    await settle();

    /**
     * Three renders, ONE call. The callback reads nothing reactive while it runs — `self.tick`
     * is inside the closure, read when `load()` is CALLED — so the cache has no dependency and
     * is never invalidated.
     *
     * That is not a stale bag, and the distinction is the whole of RMD027: a closure over `self`
     * reads the signal at call time, so the value it returns is always current even though the
     * function holding it is the same one. What would be stale is a callback that read a
     * non-reactive value INTO the bag.
     */
    expect(bags.length).toBe(1);
    expect(new Set(bags).size).toBe(1);
    expect(new Set(arrays).size).toBe(1);

    // The one closure still answers with the current value.
    expect(instance.reader.seen).toBe(5);
  });

  test("a @compute bag keeps its identity — and the callback follows it", async () => {
    const bags: unknown[] = [];
    const arrays: unknown[] = [];
    const loaders: unknown[] = [];

    class Panel extends Component {
      @state size = 1;
      @state unrelated = 0;

      /**
       * The whole bag in one compute. It recomputes only when something it READ changes — here
       * `size` — so on an unrelated render the bag, the array and the closure are all the same
       * objects as last time.
       */
      @compute get bag(): Bag {
        return {
          items: Array.from({ length: this.size }, (_, i) => i),
          load: () => this.size,
        };
      }

      reader = this.use(Reader, (self: Panel) => {
        bags.push(self.bag);
        arrays.push(self.bag.items);
        loaders.push(self.bag.load);
        return self.bag;
      });

      render() {
        return <div>{`${this.reader.seen}:${this.unrelated}`}</div>;
      }
    }

    const { instance, settle } = await getDOM<Panel>(<Panel />);
    instance.unrelated = 1;
    await settle();
    instance.unrelated = 2;
    await settle();

    /**
     * Reading a `@compute` inside the callback registers the compute's OWN dependencies as the
     * callback's — `@compute` forwards them to whatever tracker is reading it, and the props
     * cache is such a tracker. So the callback depends on `size` and not on `unrelated`, which
     * is exactly what the compute already said.
     */
    expect(bags.length).toBe(1);
    expect(new Set(bags).size).toBe(1);
    expect(new Set(arrays).size).toBe(1);
    expect(new Set(loaders).size).toBe(1);

    // And it still follows what it reads, one level down.
    instance.size = 5;
    await settle();
    expect(bags.length).toBe(2);
    expect(new Set(bags).size).toBe(2);
    expect(instance.reader.seen).toBe(10);
  });

  test("on a render the callback DID run, the props are still per-key signals", async () => {
    let scalarRuns = 0;
    let arrayRuns = 0;

    class Counted extends Hook<{ id: number; items: readonly number[]; tag: string }> {
      /** Reads a scalar prop. Rebuilding the bag does not touch it. */
      @compute get label(): string {
        scalarRuns++;
        return `#${this.props.id}`;
      }

      /** Reads a prop that is a fresh array every time the callback runs. */
      @compute get total(): number {
        arrayRuns++;
        return this.props.items.reduce((a, b) => a + b, 0);
      }
    }

    class Panel extends Component {
      @state unrelated = 0;

      // `tag` reads the signal, so this callback IS invalidated on every render — which is what
      // makes this the dirty-path case rather than a repeat of the two above.
      counted = this.use(Counted, (self: Panel) => ({ id: 7, items: [1, 2, 3], tag: `t${self.unrelated}` }));

      render() {
        return <div>{`${this.counted.label}:${this.counted.total}:${this.unrelated}`}</div>;
      }
    }

    const { instance, settle } = await getDOM<Panel>(<Panel />);
    instance.unrelated = 1;
    await settle();
    instance.unrelated = 2;
    await settle();

    /**
     * Three renders and three calls, because `tag` moved every time.
     *
     * The scalar compute ran ONCE — props are a signal per key, and `id` came back as 7 each
     * time, so nothing invalidated it. That granularity is what keeps one changed key from
     * waking the rest of the bag.
     *
     * The array compute ran three times: the update pass compares by reference, so a rebuilt
     * `[1, 2, 3]` counts as a change. This is the churn the cache does NOT remove, because the
     * call it would have skipped had to happen anyway — and it is what `@StableProps("items")`
     * on the hook, or a `@compute` holding the array, is for.
     */
    expect(scalarRuns).toBe(1);
    expect(arrayRuns).toBe(3);
  });

  test("a method is a stable function without a compute at all", async () => {
    const loaders: unknown[] = [];

    class Panel extends Component {
      @state size = 2;
      @state unrelated = 0;

      /**
       * Reads `this.size` WHEN CALLED, so there is nothing to capture — and methods are
       * auto-bound, so the identity never changes. The closure form (`load: () => self.size`)
       * does the same job, and now also keeps one identity for as long as the cache is clean.
       */
      load(): number {
        return this.size;
      }

      reader = this.use(Reader, (self: Panel) => {
        loaders.push(self.load);
        return { items: [1], load: self.load };
      });

      render() {
        return <div>{`${this.reader.seen}:${this.unrelated}`}</div>;
      }
    }

    const { instance, settle } = await getDOM<Panel>(<Panel />);
    instance.unrelated = 1;
    await settle();
    instance.size = 4;
    await settle();

    // Reading a method is not reading a signal, so the callback has no dependency and runs once.
    expect(loaders.length).toBe(1);
    expect(new Set(loaders).size).toBe(1);
    // Stable identity, current value — the two are not in tension, and `size` moving after the
    // one call is exactly the case that proves it.
    expect(instance.reader.seen).toBe(5);
  });
});
