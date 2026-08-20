import { describe, test, expect } from "vitest";
import { getDOM } from "../test/setup";
import { Component } from "../base/Component";
import { createSubscriptionDecorator, state, watchProp } from "../base/decorators";

/**
 * What a `@watchProp` selector may hand back, and what a subscription's ARGUMENTS are.
 *
 * Two questions that look like one and are not. A selector runs on every props change and its value
 * is compared with `Object.is`; a decorator's arguments are evaluated once, when the class is
 * defined. So a literal in the first is a fault and a literal in the second is nothing at all — and
 * `@ramonda/check` reports exactly one of them (`fresh-value-from-a-watch-selector`).
 *
 * | where the literal is | what happens |
 * |---|---|
 * | `@watchProp((p) => p.q)` | fires **0** times over three unrelated props changes |
 * | `@watchProp((p) => ({ q: p.q }))` | fires **3** |
 * | `@onStore({ topic: "x" })` | **one** object, shared by every instance, for the life of the class |
 */
let plainFired = 0;
let builtFired = 0;

class Child extends Component<{ q: string; other: number }> {
  @watchProp((p) => p.q)
  plain() {
    plainFired++;
  }

  @watchProp((p) => ({ q: p.q }))
  built() {
    builtFired++;
  }

  render() {
    return <li>{this.props.q}</li>;
  }
}

class Parent extends Component {
  @state other = 0;
  render() {
    return (
      <ul>
        <Child q="same" other={this.other} />
      </ul>
    );
  }
}

describe("a @watchProp selector that builds its value", () => {
  test("fires when nothing it selects has changed", async () => {
    plainFired = 0;
    builtFired = 0;
    const dom = await getDOM<Parent>(<Parent />);
    await dom.settle();

    for (let other = 1; other <= 3; other++) {
      dom.instance.other = other;
      await dom.settle();
    }

    // `q` is the same string throughout, so a selector reading it says nothing three times over.
    expect(plainFired).toBe(0);
    expect(builtFired).toBe(3);
    dom.unmount();
  });
});

/**
 * The other half, and the reason the rule does not simply look for a literal near a decorator: a
 * subscription's arguments are fixed at the source and can never depend on runtime data, so they
 * are built once when the class is defined — not per instance and not per connect.
 */
const seen: object[] = [];

const onStore = createSubscriptionDecorator(
  "onStore",
  (owner: Component & { tick?: number }, _handler: () => void, options: { topic: string }) => {
    seen.push(options);
    // Reading a signal makes the subscription follow it: the documented way to reconnect.
    void owner.tick;
    return () => {};
  },
);

class Panel extends Component {
  @state tick = 0;

  @onStore({ topic: "x" })
  changed() {}

  render() {
    return <li>{this.tick}</li>;
  }
}

class TwoPanels extends Component {
  @state tick = 0;
  render() {
    return (
      <ul>
        <Panel />
        <Panel />
      </ul>
    );
  }
}

describe("an object literal as a subscription argument", () => {
  test("is one object, however many instances connect", async () => {
    seen.length = 0;
    const dom = await getDOM<TwoPanels>(<TwoPanels />);
    await dom.settle();

    for (let tick = 1; tick <= 3; tick++) {
      dom.instance.tick = tick;
      await dom.settle();
    }

    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(new Set(seen).size).toBe(1);
    dom.unmount();
  });
});
