import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { getDOM } from "../test/setup";
import { Component } from "../base/Component";
import { Hook } from "../base/Hook";
import { compute, memoizedHandler, state } from "../base/decorators";
import { resetDiagnostics } from "../debug/diagnostics";

/**
 * RMD021 — randomness generated while a render, a `@compute` or a `@memoizedHandler`
 * builder is running.
 *
 * It watches the CALL rather than the value, which is what makes it catch things
 * RMD020's double render cannot: a value that happens to come out the same twice.
 *
 * Randomness only, and that is the finding rather than the design: a clock guard was
 * written first and reported things the app never did — an `Event` constructor stamps
 * `timeStamp`, which under jsdom is a JS-visible `Date.now()`, so any diagnostic
 * raised during a render tripped it. Nothing in the platform generates randomness
 * behind your back, so this half of the check can be trusted.
 */

let logs: string[] = [];

beforeEach(() => {
  resetDiagnostics();
  logs = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function reported(): string {
  return logs.join("\n");
}

describe("RMD021", () => {
  test("Math.random() in a render is reported, and the component is named", async () => {
    class Dice extends Component {
      render() {
        return <span>{String(Math.random())}</span>;
      }
    }

    await getDOM<Dice>(<Dice />);

    expect(reported()).toContain("RMD021");
    expect(reported()).toContain("<Dice /> called Math.random() while rendering");
  });

  test("crypto.randomUUID() in a render is reported", async () => {
    class Ids extends Component {
      render() {
        return <span data-id={crypto.randomUUID()}>row</span>;
      }
    }

    await getDOM<Ids>(<Ids />);
    expect(reported()).toContain("crypto.randomUUID()");
  });

  test("in a @compute the message says the value is frozen", async () => {
    class Panel extends Component {
      @compute get token() {
        return Math.random();
      }

      render() {
        return <span>{String(this.token)}</span>;
      }
    }

    await getDOM<Panel>(<Panel />);

    // A compute caches, so this is the quieter failure: not a mismatch, a value stuck
    // at the moment it was first asked for.
    expect(reported()).toContain("while computing");
    expect(reported()).toContain("frozen");
    expect(reported()).toContain("Panel.token");
  });

  test("in a @memoizedHandler builder it is attributed to the builder, not the render", async () => {
    class Row extends Component {
      @state picked = "";

      @memoizedHandler
      choose(id: string) {
        // Read while BUILDING, so it is cached with the handler — every click uses
        // this one value.
        const nonce = Math.random();
        return () => {
          this.picked = `${id}:${nonce}`;
        };
      }

      render() {
        return <button type="button" onClick={this.choose("a")} />;
      }
    }

    await getDOM<Row>(<Row />);

    expect(reported()).toContain("while building a memoised handler");
    expect(reported()).toContain("Row.choose");
    // The builder is CALLED from the render, so without its own phase marker the
    // report would have named the render and pointed at the wrong fix.
    expect(reported()).not.toContain("while rendering");
  });

  test("in a hook's props callback it is attributed to the bag", async () => {
    class Reader extends Hook<{ token: string }> {
      get seen(): string {
        return this.props.token;
      }
    }

    class Panel extends Component {
      reader = this.use(Reader, () => ({ token: crypto.randomUUID() }));

      render() {
        return <span>{this.reader.seen}</span>;
      }
    }

    await getDOM<Panel>(<Panel />);

    /**
     * The strangest of the four consequences, and the reason the callback does not need to run
     * twice to be caught: the callback is cached on the signals it reads, and a random value is
     * not one of them, so it is frozen into the bag until something unrelated invalidates the
     * callback and then it jumps. As a query key, an entry that moves on somebody else's state
     * change and never on this one's.
     */
    expect(reported()).toContain("while building a hook's props");
    expect(reported()).toContain("Panel → Reader");
    expect(reported()).not.toContain("while rendering");
  });

  test("outside a pure phase it says nothing", async () => {
    class Panel extends Component {
      @state token = "";

      pick() {
        // An event handler is exactly where randomness belongs.
        this.token = String(Math.random());
      }

      render() {
        return (
          <button type="button" onClick={this.pick}>
            {this.token || "pick"}
          </button>
        );
      }
    }

    const { instance, settle } = await getDOM<Panel>(<Panel />);
    instance.pick();
    await settle();

    expect(reported()).not.toContain("RMD021");
  });

  test("the framework's own reporting does not report itself", async () => {
    /**
     * The regression that killed the first version of this check. `ramondaLog` builds
     * a log entry with an id, and it dispatches a `CustomEvent` for the devtools log
     * stream — so raising ANY diagnostic during a render used to generate randomness
     * (and, when the clock was patched too, read a clock) inside the guard's own
     * window. Three of core's diagnostic tests failed with RMD021 instead of the code
     * they were asserting.
     */
    class Bad extends Component {
      @state count = 0;

      render() {
        // RMD001: a state write during render.
        this.count = this.count + 1;
        return <span>{String(this.count)}</span>;
      }
    }

    await getDOM<Bad>(<Bad />);

    expect(reported()).toContain("RMD001");
    expect(reported()).not.toContain("RMD021");
  });

  test("Date.now() in a render is NOT reported — the gap, stated on purpose", async () => {
    class Clock extends Component {
      render() {
        return <span>{String(Date.now())}</span>;
      }
    }

    await getDOM<Clock>(<Clock />);

    /**
     * Deliberate. A patched clock catches the platform's reads too — an `Event`
     * constructor stamps `timeStamp` — and under jsdom, where every app runs its own
     * tests, that means false reports attributed to whatever was rendering.
     *
     * What covers it instead: `new Date()` is caught by RMD020 every time (a fresh
     * object has a fresh identity), and `Date.now()` in a server-rendered app is
     * caught by RMD007 when the hydration disagrees. In a client-only app, rendered
     * into the output, nothing catches it.
     */
    expect(reported()).not.toContain("RMD021");
  });
});
