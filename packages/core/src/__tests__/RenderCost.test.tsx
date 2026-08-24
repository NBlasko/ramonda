import { describe, test, expect } from "vitest";
import { getDOM } from "../test/setup";
import { state } from "../base/decorators";
import { Component } from "../base/Component";
import { list } from "../base/list";
import { findOne } from "../test/setup";
import { CHILD_RECORD } from "../helpers/constants";

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

/**
 * The same list, one COMPONENT per row.
 *
 * The point of the comparison: a component owns a RANGE of nodes rather than an element, so a row is
 * an entry in the parent's record rather than a node in its child list. That is a different code
 * path through the diff, and the question this file exists to answer about it is whether it costs
 * more DOM work than the plain rows above. It must not: the floors are the same floors.
 */
class RowView extends Component<{ row: Row }> {
  render() {
    return <li className="row">{this.props.row.label}</li>;
  }
}

class KeyedComponentList extends Component {
  @state data = rows(N);
  render() {
    return (
      <ul>
        {list(this.data, (row: Row) => (
          <RowView key={row.id} row={row} />
        ))}
      </ul>
    );
  }
}

/** Three components deep, and only the innermost has markup. */
class DeepInner extends Component<{ tick: number }> {
  render() {
    return <b data-tick={this.props.tick}>deep</b>;
  }
}
class DeepMiddle extends Component<{ tick: number }> {
  render() {
    return <DeepInner tick={this.props.tick} />;
  }
}
class DeepOuter extends Component {
  @state tick = 0;
  render() {
    return (
      <div>
        <DeepMiddle tick={this.tick} />
      </div>
    );
  }
}

/** A component that renders nothing until it is asked to, between two siblings that always do. */
class Maybe extends Component {
  @state open = false;
  render() {
    return this.open ? <b id="late">here</b> : null;
  }
}
class Around extends Component {
  render() {
    return (
      <div id="around">
        <i>before</i>
        <Maybe />
        <u>after</u>
      </div>
    );
  }
}

/**
 * The same transition with no component in it: a hole in one element's own children.
 *
 * The control for the case above. Whatever it costs to put `<b>here</b>` between two siblings is
 * what the DOM charges for the markup, and the question about the region path is only whether it
 * charges anything on top.
 */
class AroundPlain extends Component {
  @state open = false;
  render() {
    return (
      <div id="around-plain">
        <i>before</i>
        {this.open ? <b id="late-plain">here</b> : null}
        <u>after</u>
      </div>
    );
  }
}

/** Elements holding a child record, and which ones. The record is the memory this design spends. */
function recorded(root: Node): string[] {
  const found: string[] = [];
  const walk = (node: Node): void => {
    if ((node as unknown as { [key: symbol]: unknown })[CHILD_RECORD] !== undefined) {
      found.push((node as Element).nodeName.toLowerCase());
    }
    node.childNodes.forEach(walk);
  };
  walk(root);
  return found;
}

describe("what a component costs, against the same markup without one", () => {
  /**
   * Every floor the plain list hits, hit by a list of components — append, prepend, swap, reverse,
   * and a fresh array that changes nothing.
   *
   * Asserted together rather than one test each, so a regression cannot be read as "only the reverse
   * case moved": the claim is that the region path costs the same as the node path across the whole
   * set, and one number moving falsifies it.
   */
  test("a list of components costs what a list of elements costs", async () => {
    const measure = async (change: (instance: KeyedComponentList) => void) => {
      const dom = await getDOM<KeyedComponentList>(<KeyedComponentList />);
      await dom.settle();
      const counts = await cost(async () => {
        change(dom.instance);
        await dom.settle();
      });
      dom.unmount();
      return counts;
    };

    const fresh = { id: 9999, label: "new" };

    expect(await measure((self) => (self.data = [...self.data, fresh]))).toMatchObject({
      insertBefore: 2,
      removeChild: 0,
      text: 0,
    });
    expect(await measure((self) => (self.data = [fresh, ...self.data]))).toMatchObject({
      insertBefore: 2,
      removeChild: 0,
      text: 0,
    });
    expect(
      await measure((self) => {
        const next = [...self.data];
        [next[1], next[N - 2]] = [next[N - 2], next[1]];
        self.data = next;
      }),
    ).toMatchObject({ insertBefore: 2, removeChild: 0, text: 0 });
    expect((await measure((self) => (self.data = [...self.data].reverse()))).insertBefore).toBe(N - 1);
    expect(await measure((self) => (self.data = [...self.data]))).toMatchObject({
      insertBefore: 0,
      appendChild: 0,
      removeChild: 0,
      setAttribute: 0,
      text: 0,
    });
  });

  /**
   * A prop travelling through three components writes one attribute, and nothing else.
   *
   * Each of the three is a region, so each one is a record entry that has to be matched, its props
   * compared, and its own block reconciled. None of that is DOM work, and none of it may become DOM
   * work: twenty passes, twenty attribute writes, no insertions.
   */
  test("a prop through three components writes one attribute per pass", async () => {
    const dom = await getDOM<DeepOuter>(<DeepOuter />);
    await dom.settle();

    const counts = await cost(async () => {
      for (let i = 0; i < 20; i++) {
        dom.instance.tick++;
        await dom.settle();
      }
    });

    expect(counts.setAttribute).toBe(20);
    expect(counts).toMatchObject({ insertBefore: 0, appendChild: 0, removeChild: 0, removeAttribute: 0, text: 0 });
    dom.unmount();
  });

  /**
   * The one case where the framework has to SEARCH for a position rather than carry one.
   *
   * A component that owns no node has nothing to place its first node relative to, and its parent is
   * not re-rendering — so the insertion point comes from the siblings in the record. `ChildrenRegion`
   * solves the same problem with a permanent comment anchor in the page; a component pays this search
   * instead, which is why there is nothing of it in the DOM.
   *
   * Measured against the control rather than against a number I picked: whatever the plain hole
   * costs, the component must cost the same. Both come out at two insertions — the text into the
   * `<b>`, and the `<b>` into its parent — which is what the DOM charges for that markup and is the
   * floor for it. The search costs no DOM operation at all, which is the claim.
   */
  test("an empty component filling in costs what a plain hole costs", async () => {
    const withComponent = await getDOM<Around>(<Around />);
    await withComponent.settle();
    const maybe = findOne<{ open: boolean }>(withComponent.container, "Maybe");
    const inner = () => withComponent.container.querySelector("#around")!.innerHTML;

    expect(inner()).toBe("<i>before</i><u>after</u>");

    const filled = await cost(async () => {
      maybe.open = true;
      await withComponent.settle();
    });

    // In the right PLACE, which is the half a count cannot show.
    expect(inner()).toBe('<i>before</i><b id="late">here</b><u>after</u>');

    const emptied = await cost(async () => {
      maybe.open = false;
      await withComponent.settle();
    });
    expect(inner()).toBe("<i>before</i><u>after</u>");
    withComponent.unmount();

    const plain = await getDOM<AroundPlain>(<AroundPlain />);
    await plain.settle();
    const plainFilled = await cost(async () => {
      plain.instance.open = true;
      await plain.settle();
    });
    const plainEmptied = await cost(async () => {
      plain.instance.open = false;
      await plain.settle();
    });
    plain.unmount();

    expect({ ...filled }).toEqual({ ...plainFilled });
    expect({ ...emptied }).toEqual({ ...plainEmptied });
    expect(filled).toMatchObject({ insertBefore: 2, appendChild: 0, removeChild: 0 });
  });

  /**
   * WHICH elements keep a child record, written down because it is the memory this design spends.
   *
   * A record is kept by an element that owns a REGION — a list, or a component — and by no other.
   * It used to be lists alone, so this number went up with the change and the honest thing is to say
   * by how much and where, rather than to leave it unmeasured.
   *
   * Here: the `<ul>` owns the list, and nothing else owns anything. The two hundred rows are
   * components, so they are entries in the `<ul>`'s record rather than record-holders themselves —
   * which is the shape that keeps this from growing with the list.
   */
  test("a record is kept by the elements that own a region, and by no others", async () => {
    const dom = await getDOM<KeyedComponentList>(<KeyedComponentList />);
    await dom.settle();

    expect(recorded(dom.container)).toEqual(["div", "ul"]);
    dom.unmount();
  });
});
