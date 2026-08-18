import { describe, test, expect } from "vitest";
import { getDOM } from "../test/setup";
import { state } from "../base/decorators";
import { Component } from "../base/Component";
import { list } from "../base/list";

/**
 * What a render costs the DOM, asserted.
 *
 * `DiffAndMerge` is the most tuned file in this package, and every optimisation in it is justified
 * by a measurement written into a comment — the slot write that is elided unless it changed, the
 * keyed nodes that are not stamped at all ("3000 real writes on every rotation, for an answer no
 * one reads"), the allocation-free fast path in `reorderChildren`. **Not one of those measurements
 * could be reproduced**: there was no benchmark anywhere in the repository. A tuning nobody can
 * re-measure is a tuning the next change quietly undoes.
 *
 * So this counts the mutations rather than the milliseconds. Wall time under jsdom says more about
 * jsdom than about the diff; the number of DOM operations is the thing the framework decides, and
 * it is the same number in any browser.
 *
 * Every count below is the theoretical minimum for the change being made, and they were minimum
 * when this was written. A number that goes UP is a regression in the diff even when every other
 * test still passes — which is exactly the failure this file exists to catch.
 */
function countDom() {
  const nodeProto = Node.prototype as unknown as Record<string, unknown>;
  const elementProto = Element.prototype as unknown as Record<string, unknown>;
  const counts = { insertBefore: 0, appendChild: 0, removeChild: 0, setAttribute: 0, removeAttribute: 0, text: 0 };
  const patched: [Record<string, unknown>, string, unknown][] = [];

  for (const [owner, name] of [
    [nodeProto, "insertBefore"],
    [nodeProto, "appendChild"],
    [nodeProto, "removeChild"],
    [elementProto, "setAttribute"],
    [elementProto, "removeAttribute"],
  ] as const) {
    const original = owner[name] as (...args: unknown[]) => unknown;
    patched.push([owner, name, original]);
    owner[name] = function (this: unknown, ...args: unknown[]) {
      counts[name as keyof typeof counts]++;
      return original.apply(this, args);
    };
  }

  // Text updates go through `data`, which is an accessor rather than a method.
  const data = Object.getOwnPropertyDescriptor(CharacterData.prototype, "data")!;
  Object.defineProperty(CharacterData.prototype, "data", {
    ...data,
    set(this: unknown, value: string) {
      counts.text++;
      data.set!.call(this, value);
    },
  });

  return {
    counts,
    stop() {
      for (const [owner, name, original] of patched) owner[name] = original;
      Object.defineProperty(CharacterData.prototype, "data", data);
    },
  };
}

const N = 200;
const rows = (n: number, from = 0) => Array.from({ length: n }, (_, i) => ({ id: from + i, label: `row ${from + i}` }));
type Row = { id: number; label: string };

class KeyedList extends Component {
  @state data = rows(N);
  render() {
    return (
      <ul>
        {list(this.data, (row: Row) => (
          <li key={row.id} className="row">
            {row.label}
          </li>
        ))}
      </ul>
    );
  }
}

let staticRenders = 0;

class StaticTree extends Component {
  @state tick = 0;
  render() {
    staticRenders++;
    return (
      <div className="a" data-tick={this.tick}>
        <header className="h">
          <h1>Title</h1>
          <p>Subtitle</p>
        </header>
        <section className="s">
          {Array.from({ length: 50 }, (_, i) => (
            <span className="c" data-i={i} key={i}>
              cell
            </span>
          ))}
        </section>
      </div>
    );
  }
}

/** Runs `body` with the DOM counted, and hands back what it asked for. */
async function cost(body: () => Promise<void>) {
  const meter = countDom();
  try {
    await body();
  } finally {
    meter.stop();
  }
  return meter.counts;
}

describe("what a render costs the DOM", () => {
  /**
   * The commonest render there is: something changed, and almost nothing about the markup did.
   * One attribute moved, so exactly one attribute is written and the other fifty-four elements are
   * not touched at all — no insert, no remove, no text.
   */
  test("a re-render writes only what changed", async () => {
    const dom = await getDOM<StaticTree>(<StaticTree />);
    await dom.settle();
    staticRenders = 0;

    const counts = await cost(async () => {
      for (let i = 0; i < 20; i++) {
        dom.instance.tick++;
        await dom.settle();
      }
    });

    // The render really ran — without this the rest of the assertions pass against nothing.
    expect(staticRenders).toBe(20);
    expect(counts.setAttribute).toBe(20);
    expect(counts).toMatchObject({ insertBefore: 0, appendChild: 0, removeChild: 0, removeAttribute: 0, text: 0 });
    dom.unmount();
  });

  /**
   * A row appended or prepended costs the same: build one `<li>`, put its text in it, put it in the
   * list. Two insertions either way — the two hundred rows already there are never touched, which
   * is the whole reason the move minimiser exists.
   */
  test("appending and prepending one row cost the same, and cost two insertions", async () => {
    for (const where of ["append", "prepend"] as const) {
      const dom = await getDOM<KeyedList>(<KeyedList />);
      await dom.settle();

      const counts = await cost(async () => {
        const fresh = { id: 9999, label: "new" };
        dom.instance.data = where === "append" ? [...dom.instance.data, fresh] : [fresh, ...dom.instance.data];
        await dom.settle();
      });

      expect({ where, ...counts }).toMatchObject({ where, insertBefore: 2, removeChild: 0, text: 0 });
      dom.unmount();
    }
  });

  /**
   * Swapping two rows two hundred apart moves two nodes. A diff without a longest increasing
   * subsequence moves everything between them.
   */
  test("swapping two rows moves two nodes", async () => {
    const dom = await getDOM<KeyedList>(<KeyedList />);
    await dom.settle();

    const counts = await cost(async () => {
      const next = [...dom.instance.data];
      [next[1], next[N - 2]] = [next[N - 2], next[1]];
      dom.instance.data = next;
      await dom.settle();
    });

    expect(counts).toMatchObject({ insertBefore: 2, removeChild: 0, text: 0 });
    dom.unmount();
  });

  /**
   * A reversal is the worst case a keyed list has and it has a floor: the longest increasing
   * subsequence of a reversed list is one element, so every other row has to move. `N - 1` is that
   * floor, not a budget — this asserts the diff hits it exactly.
   */
  test("reversing the list moves every row but one", async () => {
    const dom = await getDOM<KeyedList>(<KeyedList />);
    await dom.settle();

    const counts = await cost(async () => {
      dom.instance.data = [...dom.instance.data].reverse();
      await dom.settle();
    });

    expect(counts.insertBefore).toBe(N - 1);
    expect(counts).toMatchObject({ removeChild: 0, text: 0 });
    dom.unmount();
  });

  /**
   * The one that proves identity is inferred rather than compared by reference: a NEW array holding
   * the same rows is not a change, and costs nothing at all. This is the case
   * `row-without-a-key` in `@ramonda/check` is about — data that arrives fresh, where every object
   * is new and no reference is left to recognise.
   */
  test("the same rows in a new array cost nothing", async () => {
    const dom = await getDOM<KeyedList>(<KeyedList />);
    await dom.settle();

    const counts = await cost(async () => {
      dom.instance.data = [...dom.instance.data];
      await dom.settle();
    });

    expect(counts).toMatchObject({
      insertBefore: 0,
      appendChild: 0,
      removeChild: 0,
      setAttribute: 0,
      text: 0,
    });
    dom.unmount();
  });
});
