import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { getDOM } from "../test/setup";
import { Component } from "../base/Component";
import {
  compute,
  created,
  destroyed,
  interval,
  memoized,
  mounted,
  onDocument,
  onWindow,
  persist,
  state,
  timeout,
  updated,
  watchProp,
} from "../base/decorators";
import { resetDiagnostics } from "../debug/diagnostics";
import type { RamondaNode } from "../types/vdom";

/**
 * `RMD050` — a decorator whose effect the member already has.
 *
 * The half that matters more is the SILENCE. Two decorators on one member is usually the point: a method
 * that is both `@created` and `@updated`, a handler on both `@onWindow` and `@onDocument`. A check that
 * reported those would be worse than no check, so every one of them is asserted quiet here — measured
 * before the code was written, and each does real work twice.
 *
 * The pairs that are genuinely nonsense never reach this code at all: `@state @compute`,
 * `@compute @persist`, `@state @watchProp` and `@memoized @compute` throw from the shape
 * validators, naming the member and what it is. This code is for the gap between those two sets.
 */

let records: RamondaDiagnostic[] = [];

beforeEach(() => {
  records = [];
  resetDiagnostics();
  vi.spyOn(console, "log").mockImplementation(() => {});
  globalThis.__RAMONDA_DIAGNOSTICS__ = (record) => records.push(record);
});

afterEach(() => {
  globalThis.__RAMONDA_DIAGNOSTICS__ = undefined;
  vi.restoreAllMocks();
});

const of = (code: string) => records.filter((record) => record.code === code);

describe("a decorator that adds nothing", () => {
  test("the same one twice on a field", async () => {
    class Twice extends Component {
      @state @state n = 1;
      render(): RamondaNode {
        return <i>{this.n}</i>;
      }
    }
    const app = await getDOM<Twice>(<Twice />);

    expect(of("RMD050")).toHaveLength(1);
    expect(of("RMD050")[0]!.severity).toBe("warn");
    expect(of("RMD050")[0]!.data).toEqual({ component: "Twice", member: "n", decorator: "state", gives: "state" });

    // And it still WORKS — the report is about the belief, not about a broken field.
    app.instance.n = 5;
    await app.settle();
    expect(app.container.textContent).toBe("5");
    app.unmount();
  });

  test("`@persist` on a field that is already `@state`", async () => {
    class Both extends Component {
      @state @persist n = 1;
      render(): RamondaNode {
        return <i>{this.n}</i>;
      }
    }
    const app = await getDOM<Both>(<Both />);

    // Reported through the CAPABILITY, not the name: `@state` already puts a field in the blob, so the
    // two are one effect spelled twice. Naming the decorator would have missed this pair entirely.
    expect(of("RMD050")).toHaveLength(1);
    expect(of("RMD050")[0]!.data).toMatchObject({ member: "n", gives: "serialized" });
    app.unmount();
  });

  test("and in the other order, which is where the first attempt at this lost it", async () => {
    // Member decorators apply bottom-up, so the lower one claims first and either may be the one that
    // notices. Silencing `@state`'s derived capability caught the pair in one order and missed it in this
    // one — measured, which is why the cap is per MEMBER rather than per capability.
    class Both extends Component {
      @persist @state n = 1;
      render(): RamondaNode {
        return <i>{this.n}</i>;
      }
    }
    const app = await getDOM<Both>(<Both />);

    expect(of("RMD050")).toHaveLength(1);
    expect(of("RMD050")[0]!.data).toMatchObject({ member: "n", gives: "serialized" });
    app.unmount();
  });

  test("the same one twice on a getter and on a method", async () => {
    class Twice extends Component {
      @state n = 1;
      @compute @compute get doubled() {
        return this.n * 2;
      }
      @memoized @memoized pick(id: number) {
        return () => id;
      }
      render(): RamondaNode {
        return <i>{this.doubled}</i>;
      }
    }
    const app = await getDOM<Twice>(<Twice />);

    expect(
      of("RMD050")
        .map((r) => r.data?.gives)
        .sort(),
    ).toEqual(["computed", "memoized"]);
    expect(app.container.textContent).toBe("2");
    app.unmount();
  });

  test("one report per member, not one per instance", async () => {
    class Row extends Component<{ id: number }> {
      @state @state n = 1;
      render(): RamondaNode {
        return <i>{this.n}</i>;
      }
    }
    class List extends Component {
      render(): RamondaNode {
        return (
          <div>
            <Row id={1} />
            <Row id={2} />
            <Row id={3} />
          </div>
        );
      }
    }
    const app = await getDOM<List>(<List />);

    // The claim set is per instance, because that is where `addInitializer` runs — so without the dedup
    // key a list of a thousand rows would report a thousand times.
    expect(of("RMD050")).toHaveLength(1);
    app.unmount();
  });
});

/**
 * The silence, which is the expensive half to get wrong. Each pair does real work twice.
 */
describe("two decorators that do different work on one member stay silent", () => {
  test("the lifecycle pairs", async () => {
    const ran: string[] = [];
    class C extends Component {
      @state n = 1;
      @created @updated seedAndSync() {
        ran.push(`sync:${this.n}`);
      }
      @mounted @destroyed bothEnds() {
        ran.push("ends");
      }
      render(): RamondaNode {
        return <i>{this.n}</i>;
      }
    }
    const app = await getDOM<C>(<C />);
    app.instance.n = 2;
    await app.settle();
    app.unmount();

    expect(of("RMD050")).toEqual([]);
    // Both halves of each pair ran, which is why they are silent.
    expect(ran).toEqual(["sync:1", "ends", "sync:2", "ends"]);
  });

  test("two listeners and two timers on one method", async () => {
    const ran: string[] = [];
    class C extends Component {
      @onWindow("resize") @onDocument("click") onEither() {
        ran.push("event");
      }
      @interval(5) @timeout(5) onTick() {
        ran.push("tick");
      }
      render(): RamondaNode {
        return <i>x</i>;
      }
    }
    const app = await getDOM<C>(<C />);
    window.dispatchEvent(new Event("resize"));
    document.dispatchEvent(new Event("click"));
    await app.settle();

    expect(of("RMD050")).toEqual([]);
    expect(ran.filter((r) => r === "event")).toHaveLength(2);
    app.unmount();
  });

  test("a prop watcher that is also an @updated", async () => {
    let ran = 0;
    class Child extends Component<{ a: number }> {
      @watchProp((p: { a: number }) => p.a) @updated both() {
        ran++;
      }
      render(): RamondaNode {
        return <i>{this.props.a}</i>;
      }
    }
    class App extends Component {
      @state a = 1;
      render(): RamondaNode {
        return <Child a={this.a} />;
      }
    }
    const app = await getDOM<App>(<App />);
    ran = 0;
    app.instance.a = 2;
    await app.settle();

    expect(of("RMD050")).toEqual([]);
    // Twice on purpose: once before the render, once after the commit.
    expect(ran).toBe(2);
    app.unmount();
  });
});
