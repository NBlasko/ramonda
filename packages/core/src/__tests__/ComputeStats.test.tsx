import { describe, expect, test } from "vitest";
import { getDOM } from "../test/setup";
import { Component } from "../base/Component";
import { compute, state } from "../base/decorators";
import { inspectTree } from "../debug/devtoolsBridge";
import { setInspectRoot } from "../debug/devtoolsBridge";

/**
 * What each `@compute` cost and what it saved, per instance, for the devtools panel.
 *
 * A `@compute` is a claim that a value is worth caching, and the claim can be false in a way
 * nothing else reports: the compute is invalidated by something that moves on every pass, so every
 * read runs the body and the cache is pure overhead. The answer is still correct, so nothing looks
 * wrong.
 *
 * **A measurement, not a verdict, and the tests say so.** A compute that never hits may be
 * perfectly reasonable — its dependencies may genuinely move every time — which is why this is a
 * number in a panel rather than a diagnostic code. RMD024 is the neighbouring check and catches the
 * strictly narrower case that IS a fault: recomputing to an equal value several times running.
 */
describe("what a @compute's cache did", () => {
  test("a read after a write is a miss; every read after that is a hit", async () => {
    class Widget extends Component {
      @state n = 1;
      @compute get doubled() {
        return this.n * 2;
      }
      render() {
        return <p>{this.doubled}</p>;
      }
    }

    const app = await getDOM<Widget>(<Widget />);
    setInspectRoot(document.body);

    // The render above read it once, and that first read had to run the body.
    const first = statsFor(app.instance.constructor.name);
    expect(first.doubled).toEqual({ hits: 0, misses: 1 });

    // Reads that change nothing come off the cache.
    void app.instance.doubled;
    void app.instance.doubled;
    expect(statsFor("Widget").doubled).toEqual({ hits: 2, misses: 1 });

    // A write invalidates, so the next read runs the body again.
    app.instance.n = 2;
    await app.settle();
    void app.instance.doubled;
    const after = statsFor("Widget").doubled;
    expect(after.misses).toBeGreaterThan(1);
  });

  /**
   * The case the panel exists for: a compute reading something rebuilt on every pass. It is
   * invalidated every time, so it never answers from cache — and the counters say exactly that
   * without calling it a fault.
   */
  test("a compute invalidated on every pass shows no hits", async () => {
    class Widget extends Component {
      @state bag = { n: 1 };
      @compute get derived() {
        return this.bag.n * 2;
      }
      render() {
        return <p>{this.derived}</p>;
      }
    }

    const app = await getDOM<Widget>(<Widget />);
    setInspectRoot(document.body);

    for (let i = 0; i < 4; i++) {
      // A fresh object every time: the compute's dependency moved, so its cache is dropped.
      app.instance.bag = { n: i };
      await app.settle();
    }

    const stats = statsFor("Widget").derived;
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBeGreaterThanOrEqual(4);
  });

  /**
   * Two instances of one component are two different questions. One of them never using its cache
   * says nothing about the other, and a shared counter would average them into a number that
   * describes neither.
   */
  test("two instances are counted apart", async () => {
    class Row extends Component<{ seed: number }> {
      @state n = 1;
      @compute get doubled() {
        return this.n * 2;
      }
      render() {
        return <li>{this.doubled}</li>;
      }
    }
    class List extends Component {
      render() {
        return (
          <ul>
            <Row seed={1} />
            <Row seed={2} />
          </ul>
        );
      }
    }

    const app = await getDOM<List>(<List />);
    setInspectRoot(document.body);
    void app;

    const before = allNodes(inspectTree()).filter((n) => n.name === "Row");
    expect(before).toHaveLength(2);
    // Both start level, which is what makes the divergence below evidence rather than noise.
    expect(before[0].computes?.doubled).toEqual(before[1].computes?.doubled);

    // Read ONE of them three more times. A shared counter would move both rows.
    // Reached through the DOM node the scan carries, which is the same handle the panel uses.
    const first = (before[0].node as unknown as { _componentInstance: Row })._componentInstance;
    void first.doubled;
    void first.doubled;
    void first.doubled;

    const after = allNodes(inspectTree()).filter((n) => n.name === "Row");
    expect(after[0].computes?.doubled).toEqual({ hits: 3, misses: 1 });
    expect(after[1].computes?.doubled).toEqual({ hits: 0, misses: 1 });
  });

  /**
   * A component that HAS a `@compute` nobody has read carries no section either — not an empty one.
   * An empty `Computed` heading in the panel reads as "this component has computes and they did
   * nothing", which is the opposite of the truth.
   */
  test("computes declared but never read leave no section", async () => {
    class Widget extends Component {
      @state n = 1;
      @compute get never() {
        return this.n * 3;
      }
      render() {
        return <p>{this.n}</p>;
      }
    }

    const app = await getDOM<Widget>(<Widget />);
    setInspectRoot(document.body);
    void app;

    const node = allNodes(inspectTree()).find((n) => n.name === "Widget");
    expect(node?.computes).toBeUndefined();
  });

  test("a component with no @compute carries no section at all", async () => {
    class Bare extends Component {
      @state n = 1;
      render() {
        return <p>{this.n}</p>;
      }
    }

    const app = await getDOM<Bare>(<Bare />);
    setInspectRoot(document.body);
    void app;

    const node = allNodes(inspectTree()).find((n) => n.name === "Bare");
    expect(node?.computes).toBeUndefined();
  });

  /**
   * A declared compute nobody has read is not a compute earning nothing — it is one nobody has
   * asked for. Reporting it as `0/0` would put a row in the panel that reads like a finding.
   */
  test("a compute that has never been read is left out", async () => {
    class Widget extends Component {
      @state n = 1;
      @compute get used() {
        return this.n;
      }
      @compute get neverRead() {
        return this.n * 10;
      }
      render() {
        return <p>{this.used}</p>;
      }
    }

    const app = await getDOM<Widget>(<Widget />);
    setInspectRoot(document.body);
    void app;

    const node = allNodes(inspectTree()).find((n) => n.name === "Widget");
    expect(node?.computes).toEqual({ used: { hits: 0, misses: 1 } });
  });
});

function allNodes(nodes: ReturnType<typeof inspectTree>): ReturnType<typeof inspectTree> {
  return nodes.flatMap((n) => [n, ...allNodes(n.hooks), ...allNodes(n.children)]);
}

function statsFor(name: string): Record<string, { hits: number; misses: number }> {
  const node = allNodes(inspectTree()).find((n) => n.name === name);
  if (!node?.computes) throw new Error(`no compute stats for <${name}>`);
  return node.computes;
}
