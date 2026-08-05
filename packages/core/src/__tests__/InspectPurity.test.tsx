import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { getDOM } from "../test/setup";
import { Component } from "../base/Component";
import { Hook } from "../base/Hook";
import { state } from "../base/decorators";
import { INSPECT } from "../base/inspect";
import { resetDiagnostics } from "../debug/diagnostics";

/**
 * RMD030 — a `@state` write from inside `[INSPECT]()`.
 *
 * The panel calls that method on every commit while it is open on the components tab, so a write
 * there closes a circle: the write schedules a render, the render commits, the commit pings the
 * panel, and the panel asks again. The app changes under the person debugging it — and the values
 * on screen stop being the values the app had, which is a wrong answer given to the one reader
 * least able to doubt it.
 *
 * The third of a family: RMD001 for a write during `render()`, RMD018 during a `@compute`, this
 * during `[INSPECT]()`. All three mark a phase and check it in the `@state` setter.
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
const scan = () => (window as unknown as { __RAMONDA_INSPECT__?: () => unknown[] }).__RAMONDA_INSPECT__?.();

describe("RMD030", () => {
  test("a write while describing is reported, and names the field", async () => {
    class Panel extends Component {
      @state ticks = 0;

      [INSPECT]() {
        this.ticks = this.ticks + 1;
        return { ticks: this.ticks };
      }

      render() {
        return <p>{String(this.ticks)}</p>;
      }
    }

    await getDOM<Panel>(<Panel />);
    scan();

    expect(reported()).toContain("RMD030");
    expect(reported()).toContain("<Panel /> wrote to `ticks`");
    expect(reported()).toContain("[INSPECT]()");
  });

  test("a hook is named too, not just a component", async () => {
    class Meter extends Hook {
      @state hits = 0;

      [INSPECT]() {
        this.hits = this.hits + 1;
        return { hits: this.hits };
      }
    }

    class Page extends Component {
      meter = this.use(Meter);
      render() {
        return <p>x</p>;
      }
    }

    await getDOM(<Page />);
    scan();

    expect(reported()).toContain("<Meter /> wrote to `hits`");
  });

  test("a pure describe says nothing, however many scans", async () => {
    class Panel extends Component {
      @state count = 3;
      private label = "steady";

      [INSPECT]() {
        // Reads, derives, returns — and a plain field is fine to touch, because nothing observes it.
        return { count: this.count, label: this.label, doubled: this.count * 2 };
      }

      render() {
        return <p>{String(this.count)}</p>;
      }
    }

    const { settle } = await getDOM<Panel>(<Panel />);
    for (let i = 0; i < 5; i++) {
      scan();
      await settle();
    }

    expect(reported()).not.toContain("RMD030");
  });

  test("a write that changes nothing is still reported", async () => {
    class Panel extends Component {
      @state mode = "idle";

      [INSPECT]() {
        // No render is scheduled by this, so there is no loop — and it is still a write from a
        // method whose contract is to read. The same stance the `@compute` check takes.
        this.mode = "idle";
        return { mode: this.mode };
      }

      render() {
        return <p>{this.mode}</p>;
      }
    }

    await getDOM(<Panel />);
    scan();

    expect(reported()).toContain("RMD030");
  });

  test("writing a plain field is silent — that is the recommended way to cache", async () => {
    class Panel extends Component {
      @state version = 0;
      private cached: string | undefined;

      [INSPECT]() {
        // What `Form` and `Mutation` do: the value lives in a plain field behind a `@state`
        // counter, so touching it observes nothing and schedules nothing.
        this.cached ??= "computed once";
        return { cached: this.cached };
      }

      render() {
        return <p>{String(this.version)}</p>;
      }
    }

    await getDOM(<Panel />);
    scan();

    expect(reported()).not.toContain("RMD030");
  });

  test("a write AFTER the scan is not attributed to it", async () => {
    class Panel extends Component {
      @state ticks = 0;

      [INSPECT]() {
        return { ticks: this.ticks };
      }

      render() {
        return <p>{String(this.ticks)}</p>;
      }
    }

    const { instance, settle } = await getDOM<Panel>(<Panel />);
    scan();

    // An ordinary write, once the walk is over. The phase must have been cleared.
    instance.ticks = 1;
    await settle();

    expect(reported()).not.toContain("RMD030");
  });

  test("a describe that throws still clears the phase", async () => {
    class Broken extends Component {
      @state n = 0;

      [INSPECT](): Record<string, unknown> {
        throw new Error("mid-construction");
      }

      render() {
        return <p>{String(this.n)}</p>;
      }
    }

    const { instance, settle } = await getDOM<Broken>(<Broken />);
    scan();

    // Restored in a `finally`. Without that, this next write — which has nothing to do with the
    // panel — would be reported as though it came from inside the describe.
    instance.n = 1;
    await settle();

    expect(reported()).not.toContain("RMD030");
  });

  test("reported once per field, not once per scan", async () => {
    class Panel extends Component {
      @state ticks = 0;

      [INSPECT]() {
        this.ticks = this.ticks + 1;
        return { ticks: this.ticks };
      }

      render() {
        return <p>{String(this.ticks)}</p>;
      }
    }

    const { settle } = await getDOM<Panel>(<Panel />);
    for (let i = 0; i < 5; i++) {
      scan();
      await settle();
    }

    expect(reported().split("RMD030").length - 1).toBe(1);
  });
});
