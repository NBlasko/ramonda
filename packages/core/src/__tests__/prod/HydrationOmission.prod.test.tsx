import { describe, test, expect } from "vitest";
import { Component, state, persist } from "../../index";
import { getDOM } from "../../test/setup";
import { serializeComponentTree } from "../../hydration/serialize";

/**
 * The hydration blob leaves out a field still holding the primitive its own initializer produced.
 * This run proves it in PRODUCTION, and the reason it needs its own run is a divergence that
 * already caught this work once.
 *
 * The rule is restricted to primitives because an in-place mutation keeps the very object the
 * initializer produced, so an identity test on an object would call a filled array untouched and
 * hand the client an empty one. In DEVELOPMENT that hazard is masked: `mutationGuard` wraps plain
 * objects and arrays in a proxy, so `this.rows` never reads back as the raw array and the identity
 * test cannot fire even when the guard is removed — measured, a planted fault passed the whole
 * development suite.
 *
 * There is no proxy here. So this is the run in which the primitives-only bound is load-bearing
 * rather than incidental, and the one where removing it would be caught.
 */
describe("production: what the hydration blob leaves out", () => {
  test("__DEV__ is false in this run", () => {
    expect(__DEV__).toBe(false);
  });

  test("a field still holding its initial primitive is left out; one that moved is not", async () => {
    class Widget extends Component {
      @state version = 0;
      @state touched = 0;
      @persist token = "abc";
      render() {
        return <div>x</div>;
      }
    }

    const app = await getDOM<Widget>(<Widget />);
    app.instance.touched = 1;
    await app.settle();

    expect(serializeComponentTree(app.instance).state).toEqual({ touched: 1 });
  });

  /**
   * The case the development run cannot reach. With no proxy in the way, `this.rows` IS the array
   * the initializer produced — so if the record ever started accepting objects, this array would be
   * called untouched and the client would hydrate an empty list while the server's markup showed
   * two items.
   */
  test("an array mutated in place is serialized, with no proxy standing in for it", async () => {
    class Widget extends Component {
      @state rows: string[] = [];
      render() {
        return <div>x</div>;
      }
    }

    const app = await getDOM<Widget>(<Widget />);
    // No RMD005 here — the guard that reports this is development-only. The push simply happens.
    app.instance.rows.push("a", "b");
    await app.settle();

    expect(serializeComponentTree(app.instance).state).toEqual({ rows: ["a", "b"] });
  });

  /**
   * `undefined` cannot ride in `state` — `JSON.stringify({ x: undefined })` is `{}` — so a field the
   * server EMPTIED travels in its own list. Production is where that matters: it is the run that
   * serves pages.
   */
  test("a field emptied on the server travels as cleared", async () => {
    class Widget extends Component {
      @state name: string | undefined = "Ada";
      render() {
        return <div>x</div>;
      }
    }

    const app = await getDOM<Widget>(<Widget />);
    app.instance.name = undefined;
    await app.settle();

    const tree = serializeComponentTree(app.instance);
    expect(tree.cleared).toEqual(["name"]);
    expect(tree.state).toEqual({});
  });
});
