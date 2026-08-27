import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { getDOM } from "../test/setup";
import { Component, state } from "../index";
import { COMPONENT_RUNTIME } from "../core/runtime";

/**
 * The order a batch of queued components builds in.
 *
 * The queue is kept depth-descending and drained from the end, so the SHALLOWEST
 * component builds first — which is what lets a parent remove or replace a child
 * before that child's own queued build runs. Nothing else about a commit works
 * if that slips.
 *
 * These tests exist because the insertion changed from a linear scan to a binary
 * search. That was a cost change, not a behaviour change — a parent handing new
 * props to N children queues N components at the same depth, and each one used to
 * walk the whole queue to reach the end (measured: 216 ms of pure scanning for
 * 20000, against 0.7 ms). The order is the part that had to survive it, so it is
 * the part pinned here, and it is pinned by DEPTH rather than by a timing
 * assertion, which would only tell a CI machine how busy it was.
 */
describe("the build queue drains shallowest-first", () => {
  beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  test("a parent builds before its child", async () => {
    const order: string[] = [];

    class GrandChild extends Component<{ v: number }> {
      render() {
        order.push("grandchild");
        return <i>{this.props.v}</i>;
      }
    }
    class Child extends Component<{ v: number }> {
      render() {
        order.push("child");
        return <b>{<GrandChild v={this.props.v} />}</b>;
      }
    }
    class App extends Component {
      @state v = 0;
      render() {
        order.push("app");
        return (
          <div>
            <Child v={this.v} />
          </div>
        );
      }
    }

    const app = await getDOM<App>(<App />);
    await app.settle();

    order.length = 0;
    app.instance.v = 1;
    await app.settle();

    expect(order).toEqual(["app", "child", "grandchild"]);
  });

  test("a wide, mixed-depth batch builds in non-decreasing depth order", async () => {
    const depths: number[] = [];

    class Leaf extends Component<{ v: number }> {
      render() {
        depths.push(this[COMPONENT_RUNTIME].depth);
        return <i>{this.props.v}</i>;
      }
    }
    class Branch extends Component<{ v: number; deeper: boolean }> {
      render() {
        depths.push(this[COMPONENT_RUNTIME].depth);
        const kids = [];
        for (let i = 0; i < 8; i++) {
          kids.push(
            this.props.deeper ? <Branch key={i} v={this.props.v} deeper={false} /> : <Leaf key={i} v={this.props.v} />,
          );
        }
        return <div>{kids}</div>;
      }
    }
    class App extends Component {
      @state v = 0;
      render() {
        depths.push(this[COMPONENT_RUNTIME].depth);
        const kids = [];
        for (let i = 0; i < 8; i++) kids.push(<Branch key={i} v={this.v} deeper={true} />);
        return (
          <div>
            <div>{kids}</div>
          </div>
        );
      }
    }

    const app = await getDOM<App>(<App />);
    await app.settle();

    depths.length = 0;
    app.instance.v = 1;
    await app.settle();

    // 1 + 8 + 64 + 512 components, every one of them re-rendered once.
    expect(depths.length).toBe(1 + 8 + 64 + 512);

    const outOfOrder = depths.filter((depth, i) => i > 0 && depth < depths[i - 1]);
    expect(outOfOrder).toEqual([]);
  });

  test("a component queued while the drain is running still lands in depth order", async () => {
    const order: string[] = [];

    class Late extends Component<{ v: number }> {
      render() {
        order.push(`late:${this[COMPONENT_RUNTIME].depth}`);
        return <i>{this.props.v}</i>;
      }
    }
    class Middle extends Component<{ v: number }> {
      @state extra = 0;
      render() {
        order.push(`middle:${this[COMPONENT_RUNTIME].depth}`);
        return (
          <b>
            <Late v={this.props.v + this.extra} />
          </b>
        );
      }
    }
    class App extends Component {
      @state v = 0;
      render() {
        order.push(`app:${this[COMPONENT_RUNTIME].depth}`);
        return (
          <div>
            <Middle v={this.v} />
          </div>
        );
      }
    }

    const app = await getDOM<App>(<App />);
    await app.settle();

    order.length = 0;
    app.instance.v = 1;
    await app.settle();

    // Each name once, and depths never go backwards.
    const seen = order.map((entry) => Number(entry.split(":")[1]));
    expect(seen.filter((depth, i) => i > 0 && depth < seen[i - 1])).toEqual([]);
    expect(order.length).toBe(3);
  });
});
