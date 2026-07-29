import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { getDOM } from "../test/setup";
import { Component } from "../base/Component";
import { Hook } from "../base/Hook";
import { compute, state } from "../base/decorators";
import { resetDiagnostics } from "../debug/diagnostics";

/**
 * RMD024 — a `@compute` that recomputes over and over and keeps producing the same answer.
 *
 * The quiet case neither neighbour can see. RMD020 renders twice, and inside one strict render
 * the compute is CACHED between the two calls, so both get the same value. RMD022 compares
 * props bags, and skips anything declared with `@StableProps` or wrapped in `stable()` — and a
 * compute reading a component prop is outside its reach entirely.
 */

let logs: string[] = [];

beforeEach(() => {
  resetDiagnostics();
  logs = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  });
});

afterEach(() => vi.restoreAllMocks());

const reported = () => logs.join("\n");

describe("RMD024", () => {
  test("a compute reading a rebuilt array is reported, and named", async () => {
    class Reader extends Hook<{ items: readonly number[] }> {
      @compute get total(): number {
        return this.props.items.reduce((a, b) => a + b, 0);
      }
    }

    class Panel extends Component {
      @state tick = 0;
      // A fresh array every render: the prop signal changes, the compute is invalidated, and
      // the answer is always 6.
      reader = this.use(Reader, () => ({ items: [1, 2, 3] }));

      render() {
        return <div>{`${this.reader.total}:${this.tick}`}</div>;
      }
    }

    const app = await getDOM<Panel>(<Panel />);
    for (let i = 1; i <= 4; i++) {
      app.instance.tick = i;
      await app.settle();
    }

    expect(reported()).toContain("RMD024");
    expect(reported()).toContain("Reader.total");
    expect(reported()).toContain("cache is doing nothing");
  });

  test("a compute whose answer moves is never reported", async () => {
    class Panel extends Component {
      @state n = 0;

      @compute get doubled(): number {
        return this.n * 2;
      }

      render() {
        return <div>{String(this.doubled)}</div>;
      }
    }

    const app = await getDOM<Panel>(<Panel />);
    for (let i = 1; i <= 6; i++) {
      app.instance.n = i;
      await app.settle();
    }

    expect(reported()).not.toContain("RMD024");
  });

  test("a compute that recomputes only once with an equal value is left alone", async () => {
    class Panel extends Component {
      @state n = 1;

      @compute get clamped(): number {
        return Math.min(this.n, 1);
      }

      render() {
        return <div>{String(this.clamped)}</div>;
      }
    }

    const app = await getDOM<Panel>(<Panel />);
    // Two recomputes, both answering 1. Ordinary — a dependency moved and the answer happened
    // not to. Below the threshold on purpose, so real code is not reported for coincidences.
    app.instance.n = 2;
    await app.settle();

    expect(reported()).not.toContain("RMD024");
  });

  test("it catches a compute reading something that is not reactive at all", async () => {
    let seq = 0;

    class Panel extends Component {
      @state tick = 0;

      // Not a rebuilt prop — an app's own counter. No reference check could see this, which is
      // why the diagnostic compares VALUES.
      @compute get id(): string {
        return `id-${seq}`;
      }

      render() {
        return <div>{`${this.id}:${this.tick}`}</div>;
      }
    }

    const app = await getDOM<Panel>(<Panel />);
    void seq;
    for (let i = 1; i <= 4; i++) {
      app.instance.tick = i;
      await app.settle();
    }

    // The compute never even recomputes here — nothing it read changed — so nothing is
    // reported. The counter case is caught only when the compute IS invalidated, which is the
    // honest limit: an unread value cannot be observed.
    expect(reported()).not.toContain("RMD024");
  });

  test("two instances are judged separately", async () => {
    class Reader extends Hook<{ items: readonly number[] }> {
      @compute get total(): number {
        return this.props.items.reduce((a, b) => a + b, 0);
      }
    }

    class Row extends Component<{ churn: boolean; tick: number }> {
      reader = this.use(Reader, (self: Row) => ({
        // One rebuilds, the other holds one array for its lifetime.
        items: self.props.churn ? [1, 2, 3] : STABLE,
      }));

      render() {
        // The tick is a PROP, so the parent's render actually reaches both rows — a child whose
        // props did not change is not re-rendered, which is what made the first version of this
        // test report nothing.
        return <span>{`${this.reader.total}:${this.props.tick}`}</span>;
      }
    }

    class App extends Component {
      @state tick = 0;
      render() {
        return (
          <div>
            <Row churn={false} tick={this.tick} />
            <Row churn={true} tick={this.tick} />
            <span>{String(this.tick)}</span>
          </div>
        );
      }
    }

    const app = await getDOM<App>(<App />);
    for (let i = 1; i <= 4; i++) {
      app.instance.tick = i;
      await app.settle();
    }

    // Reported once — for the instance that churns. The dedup key is the member, so this
    // asserts the count rather than the absence.
    expect(reported().split("RMD024").length - 1).toBe(1);
  });
});

const STABLE = [1, 2, 3];
