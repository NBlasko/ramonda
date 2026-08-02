import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { getDOM } from "../test/setup";
import { state, compute, create, destroy, mount, interval, Host } from "../base/decorators";
import { Component } from "../base/Component";
import { createContext } from "../base/Context";
import { resetDiagnostics } from "../debug/diagnostics";

/** Collects diagnostics off the dev-log channel instead of scraping console. */
function captureDiagnostics() {
  const codes: string[] = [];
  const messages: string[] = [];
  const handler = (event: Event) => {
    const detail = (event as CustomEvent).detail as { message: string };
    const code = detail.message.match(/^\[(RMD\d+)\]/)?.[1];
    if (!code) return;
    codes.push(code);
    messages.push(detail.message);
  };
  window.addEventListener("ramonda:dev-log", handler);
  return {
    codes,
    messages,
    stop: () => window.removeEventListener("ramonda:dev-log", handler),
  };
}

describe("DEV diagnostics", () => {
  let captured: ReturnType<typeof captureDiagnostics>;

  beforeEach(() => {
    // Each test must see its own diagnostic — they are deduped globally.
    resetDiagnostics();
    vi.spyOn(console, "log").mockImplementation(() => {});
    captured = captureDiagnostics();
  });

  afterEach(() => {
    captured.stop();
    vi.restoreAllMocks();
  });

  test("RMD001: reports state written during render", async () => {
    class Bad extends Component {
      @state count = 0;
      render() {
        // Settles on the second render (1 === 1, no update). An unconditional
        // `count + 1` here would never settle — which is the bug this reports.
        this.count = 1;
        return <div>{this.count}</div>;
      }
    }

    await getDOM<Bad>(<Bad />);

    expect(captured.codes).toContain("RMD001");
    expect(captured.messages[0]).toContain("<Bad /> wrote to `count`");
    // The fix hint is the point of the diagnostic, not just the label.
    expect(captured.messages[0]).toContain("@compute");
  });

  test("RMD001: stays quiet for a component that only reads in render", async () => {
    class Good extends Component {
      @state count = 0;
      render() {
        return <div>{this.count}</div>;
      }
    }

    const app = await getDOM<Good>(<Good />);
    app.instance.count = 5;
    await app.settle();

    expect(captured.codes).not.toContain("RMD001");
  });

  test("RMD001: a write from an event handler is not a render write", async () => {
    class Fine extends Component {
      @state count = 0;
      bump() {
        this.count++;
      }
      render() {
        return <button onclick={this.bump}>{this.count}</button>;
      }
    }

    const app = await getDOM<Fine>(<Fine />);
    await app.user.click(app.container.querySelector("button")!);
    await app.settle();

    expect(captured.codes).not.toContain("RMD001");
  });

  test("RMD018: reports state written inside a @compute", async () => {
    class Bad extends Component {
      @state count = 0;
      @state runs = 0;
      @compute get doubled() {
        // The thing this diagnostic exists to catch: deriving is not the place
        // to write reactive state.
        this.runs = this.runs + 1;
        return this.count * 2;
      }
      render() {
        return <div>{this.doubled}</div>;
      }
    }

    await getDOM<Bad>(<Bad />);

    expect(captured.codes).toContain("RMD018");
    expect(captured.messages.find((m) => m.includes("RMD018"))).toContain("`Bad.doubled` (a @compute) wrote to `runs`");
  });

  test("RMD018: a compute that only reads, and instruments with a plain field, stays quiet", async () => {
    class Good extends Component {
      @state count = 0;
      // Not @state — the sanctioned way to count runs. No reactive write.
      runs = 0;
      @compute get doubled() {
        this.runs++;
        return this.count * 2;
      }
      render() {
        return <div>{this.doubled}</div>;
      }
    }

    const app = await getDOM<Good>(<Good />);
    app.instance.count = 5;
    await app.settle();

    expect(captured.codes).not.toContain("RMD018");
    // The plain field still counted the two runs, proving it is a viable
    // instrument without reaching for state.
    expect(app.instance.runs).toBe(2);
  });

  test("RMD018: a write from an event handler is not a compute write", async () => {
    class Fine extends Component {
      @state count = 0;
      @compute get doubled() {
        return this.count * 2;
      }
      bump() {
        // Reads the compute AND writes state — but the write is on the handler's
        // stack, not the compute's, so it must not be reported.
        this.count = this.doubled + 1;
      }
      render() {
        return <button onclick={this.bump}>{this.doubled}</button>;
      }
    }

    const app = await getDOM<Fine>(<Fine />);
    await app.user.click(app.container.querySelector("button")!);
    await app.settle();

    expect(captured.codes).not.toContain("RMD018");
  });

  test("RMD002: reports duplicate keys among siblings", async () => {
    class Dup extends Component {
      render() {
        return (
          <ul>
            {["a", "a", "b"].map((k) => (
              <li key={k}>{k}</li>
            ))}
          </ul>
        );
      }
    }

    await getDOM<Dup>(<Dup />);

    expect(captured.codes).toContain("RMD002");
    expect(captured.messages[0]).toContain('key "a"');
  });

  test("RMD002: allows a static child next to a keyed list", async () => {
    class Mixed extends Component {
      render() {
        return (
          <ul>
            <li>Header</li>
            {["a", "b"].map((k) => (
              <li key={k}>{k}</li>
            ))}
          </ul>
        );
      }
    }

    await getDOM<Mixed>(<Mixed />);

    expect(captured.codes).toEqual([]);
  });

  test("RMD003: reports a consumer with no provider above it", async () => {
    const [, ThemeConsumer] = createContext({ theme: "light" }, { label: "Theme" });

    class Orphan extends Component {
      ctx = this.use(ThemeConsumer);
      render() {
        return <span>{this.ctx.theme}</span>;
      }
    }

    await getDOM<Orphan>(<Orphan />);

    expect(captured.codes).toContain("RMD003");
    expect(captured.messages[0]).toContain("<Orphan /> mounts ThemeConsumer with no Provider");
  });

  test("RMD003: stays quiet when the context says its default is a real answer", async () => {
    const [, LooseConsumer] = createContext({ theme: "light" }, { label: "Loose", optional: true });

    class Quiet extends Component {
      ctx = this.use(LooseConsumer);
      render() {
        return <span>{this.ctx.theme}</span>;
      }
    }

    await getDOM<Quiet>(<Quiet />);

    expect(captured.codes).not.toContain("RMD003");
  });

  test("RMD003: stays quiet when a provider is above", async () => {
    const [ThemeProvider, ThemeConsumer] = createContext({ theme: "light" });

    class Reader extends Component {
      ctx = this.use(ThemeConsumer);
      render() {
        return <span>{this.ctx.theme}</span>;
      }
    }
    class App extends Component {
      provider = this.use(ThemeProvider, () => ({ theme: "dark" }));
      render() {
        return <Reader />;
      }
    }

    await getDOM<App>(<App />);

    expect(captured.codes).not.toContain("RMD003");
  });

  test("RMD004: a write to props throws and is reported", async () => {
    @Host("div")
    class Mutator extends Component<{ label: string }> {
      /** Exposed so the test can trigger the write outside the mount path. */
      mutate(): void {
        (this.props as { label: string }).label = "changed";
      }
      render() {
        return <span>{this.props.label}</span>;
      }
    }

    const app = await getDOM<Mutator>(<Mutator label="original" />);

    expect(() => app.instance.mutate()).toThrow(/RMD004/);
    expect(captured.codes).toContain("RMD004");
    expect(captured.messages[0]).toContain("`props.label`");
    // The parent still owns the value — the throw is what keeps it that way.
    expect(app.container.textContent).toBe("original");
  });

  test("deduplicates: one report per source, not per occurrence", async () => {
    // Mirroring a prop into state from render — the exact misuse @watchProp
    // exists for. Every prop change makes the write land again.
    class Mirror extends Component<{ n: number }> {
      @state mirror = -1;
      render() {
        this.mirror = this.props.n;
        return <span>{this.mirror}</span>;
      }
    }
    class Parent extends Component {
      @state n = 0;
      render() {
        return <Mirror n={this.n} />;
      }
    }

    const app = await getDOM<Parent>(<Parent />);
    app.instance.n = 1;
    await app.settle();
    app.instance.n = 2;
    await app.settle();

    // The write landed on every prop change; it is reported once.
    expect(captured.codes.filter((c) => c === "RMD001")).toHaveLength(1);
  });

  test("RMD005: reports an array mutated in place", async () => {
    class TodoList extends Component {
      @state items: string[] = ["a"];
      render() {
        return <ul>{this.items.length}</ul>;
      }
    }

    const app = await getDOM<TodoList>(<TodoList />);
    app.instance.items.push("b");
    await app.settle();

    expect(captured.codes).toContain("RMD005");
    expect(captured.messages[0]).toContain("`TodoList.items.push(…)`");
    // The mutation lands but nothing re-renders — which is the whole complaint.
    expect(app.container.textContent).toBe("1");
  });

  test("RMD005: reports index and length writes too", async () => {
    class Board extends Component {
      @state cells: number[] = [1, 2, 3];
      render() {
        return <div>{this.cells.length}</div>;
      }
    }

    const app = await getDOM<Board>(<Board />);
    app.instance.cells[0] = 99;
    await app.settle();

    expect(captured.codes).toContain("RMD005");
    expect(captured.messages[0]).toContain("`Board.cells[0] = …`");
  });

  test("RMD005: stays quiet for reassignment and for reads", async () => {
    class TodoList extends Component {
      @state items: string[] = ["a"];
      render() {
        return <ul>{this.items.join(",")}</ul>;
      }
    }

    const app = await getDOM<TodoList>(<TodoList />);

    app.instance.items = [...app.instance.items, "b"];
    await app.settle();
    // Non-mutating reads must pass straight through.
    expect(app.instance.items.map((i) => i)).toEqual(["a", "b"]);
    expect(app.instance.items.filter(Boolean)).toEqual(["a", "b"]);

    // slice() hands back a plain array — copy-then-reassign stays clean.
    const copy = app.instance.items.slice();
    copy.push("c");
    app.instance.items = copy;
    await app.settle();

    expect(captured.codes).toEqual([]);
    expect(app.container.textContent).toBe("a,b,c");
  });

  test("RMD005: array identity is stable across reads", async () => {
    class Holder extends Component {
      @state items = [1, 2];
      render() {
        return <div>{this.items.length}</div>;
      }
    }

    const app = await getDOM<Holder>(<Holder />);

    // A fresh proxy per read would break every === the diff relies on.
    expect(app.instance.items).toBe(app.instance.items);
  });

  test("RMD006: reports a raw setInterval left running after unmount", async () => {
    class Clock extends Component {
      @create start() {
        setInterval(() => {}, 10_000);
      }
      render() {
        return <div>tick</div>;
      }
    }

    const app = await getDOM<Clock>(<Clock />);
    app.unmount();

    expect(captured.codes).toContain("RMD006");
    expect(captured.messages[0]).toContain("<Clock /> unmounted with a setInterval(…, 10000) still running");
    expect(captured.messages[0]).toContain("@interval");
  });

  test("RMD006: stays quiet when @destroy clears the timer", async () => {
    class Clock extends Component {
      private timerId: ReturnType<typeof setInterval> | undefined;
      @create start() {
        this.timerId = setInterval(() => {}, 10_000);
      }
      @destroy stop() {
        clearInterval(this.timerId);
      }
      render() {
        return <div>tick</div>;
      }
    }

    const app = await getDOM<Clock>(<Clock />);
    app.unmount();

    expect(captured.codes).not.toContain("RMD006");
  });

  test("RMD006: stays quiet for @interval, which cleans up itself", async () => {
    class Clock extends Component {
      @state ticks = 0;
      @interval(10_000) tick() {
        this.ticks++;
      }
      render() {
        return <div>{this.ticks}</div>;
      }
    }

    const app = await getDOM<Clock>(<Clock />);
    app.unmount();

    expect(captured.codes).not.toContain("RMD006");
  });

  test("RMD006: attributes a timer to the child that started it, not the parent", async () => {
    @Host("div")
    class Child extends Component {
      @create start() {
        setInterval(() => {}, 10_000);
      }
      render() {
        return <span>child</span>;
      }
    }
    class Parent extends Component {
      @state showChild = true;
      // Runs after the child is built — must not inherit the child's ownership.
      @mount fine() {}
      render() {
        return <div>{this.showChild ? <Child /> : null}</div>;
      }
    }

    const app = await getDOM<Parent>(<Parent />);
    app.unmount();

    expect(captured.messages[0]).toContain("<Child />");
    expect(captured.messages[0]).not.toContain("<Parent />");
  });

  test("a well-behaved app produces no diagnostics at all", async () => {
    const [CtxProvider, Ctx] = createContext({ user: "nikola" });

    class Row extends Component<{ label: string }> {
      ctx = this.use(Ctx);
      render() {
        return (
          <li>
            {this.props.label}:{this.ctx.user}
          </li>
        );
      }
    }
    class App extends Component {
      @state items = ["a", "b", "c"];
      provider = this.use(CtxProvider, () => ({ user: "nikola" }));
      render() {
        return (
          <ul>
            {this.items.map((i) => (
              <Row key={i} label={i} />
            ))}
          </ul>
        );
      }
    }

    const app = await getDOM<App>(<App />);
    app.instance.items = ["c", "a", "b"];
    await app.settle();

    expect(captured.codes).toEqual([]);
  });
});
