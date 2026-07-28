import { describe, test, expect } from "vitest";
import { getDOM } from "../../test/setup";
import { Component } from "../../base/Component";
import { Hook } from "../../base/Hook";
import { compute, state } from "../../base/decorators";

/**
 * A hook's props bag is rebuilt on every render of its owner — that is the contract of
 * the callback form, and what keeps a hook in step. These tests pin down the two ways
 * to make what is IN the bag stable anyway, for when something reactive reads it: a
 * `@compute` reading a rebuilt array recomputes every render, and a subscription whose
 * `connect` reads one re-subscribes every render.
 *
 * Both forms work today with no framework support. They are here because nothing else
 * proves they keep working: a future change to `useCommon` could break either without
 * a single existing test noticing.
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
  test("the baseline: an inline bag is a new object, with new values, every render", async () => {
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

    // Three renders, three bags, three arrays. Nothing is wrong with this — it is what
    // the two forms below exist to avoid when something reactive reads the bag.
    expect(bags.length).toBe(3);
    expect(new Set(bags).size).toBe(3);
    expect(new Set(arrays).size).toBe(3);
  });

  test("a @compute bag keeps its identity — and the closure inside it", async () => {
    const bags: unknown[] = [];
    const arrays: unknown[] = [];
    const loaders: unknown[] = [];

    class Panel extends Component {
      @state size = 1;
      @state unrelated = 0;

      /**
       * The whole bag in one compute. It recomputes only when something it READ
       * changes — here `size` — so on an unrelated render the bag, the array and the
       * closure are all the same objects as last time.
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

    // Three renders, ONE of everything.
    expect(bags.length).toBe(3);
    expect(new Set(bags).size).toBe(1);
    expect(new Set(arrays).size).toBe(1);
    expect(new Set(loaders).size).toBe(1);

    // And it still follows what it reads.
    instance.size = 5;
    await settle();
    expect(new Set(bags).size).toBe(2);
    expect(instance.reader.seen).toBe(10);
  });

  test("what protects a hook's own @compute: the props are per-key signals", async () => {
    let scalarRuns = 0;
    let arrayRuns = 0;

    class Counted extends Hook<{ id: number; items: readonly number[] }> {
      /** Reads a scalar prop. Rebuilding the bag does not touch it. */
      @compute get label(): string {
        scalarRuns++;
        return `#${this.props.id}`;
      }

      /** Reads a prop that is a fresh array every render. */
      @compute get total(): number {
        arrayRuns++;
        return this.props.items.reduce((a, b) => a + b, 0);
      }
    }

    class Panel extends Component {
      @state unrelated = 0;
      counted = this.use(Counted, () => ({ id: 7, items: [1, 2, 3] }));

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
     * Three renders. The scalar compute ran ONCE — props are a signal per key, and
     * `id` never moved, so nothing invalidated it. That granularity is the whole
     * protection, and it covers most bags.
     *
     * The array compute ran three times: the update pass compares by reference
     * (`newVal !== prevProps[key]`), so a rebuilt `[1, 2, 3]` counts as a change and
     * wakes the signal. The cache does nothing for it — the case the section on
     * stabilising a bag exists for.
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
       * Reads `this.size` WHEN CALLED, so there is nothing to capture — and methods
       * are auto-bound, so the identity never changes. The closure form
       * (`load: () => self.size`) does the same job with a new function each render.
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

    expect(loaders.length).toBe(3);
    expect(new Set(loaders).size).toBe(1);
    // Stable identity, current value — the two are not in tension.
    expect(instance.reader.seen).toBe(5);
  });
});
