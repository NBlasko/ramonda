import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { getDOM } from "../test/setup";
import { state, compute, created, destroyed, mounted, interval, Host } from "../base/decorators";
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

  /**
   * One Provider of a context per component, REFUSED rather than reported.
   *
   * The second publish would replace the first and hand every descendant the second whichever part
   * of the tree it is in, while the component itself could still read both — a wrong value that is
   * invisible from the one place that made it. There is no reading of two the framework could
   * honour, so it throws in every build, like a write to props (RMD004/RMD015) and a plain-object
   * props bag (RMD055).
   */
  test("RMD056: a second Provider of one context on one component is refused", () => {
    const [ThemeProvider] = createContext({ theme: "light" }, { label: "Theme" });

    class Twice extends Component {
      first = this.use(ThemeProvider, () => ({ theme: "first" }));
      second = this.use(ThemeProvider, () => ({ theme: "second" }));
      render() {
        return <span>twice</span>;
      }
    }

    // Constructed directly: the throw happens while the field initialisers run, so it does not need
    // a render to arrive, and asserting on `new` keeps the failure out of the diff's error handling.
    expect(() => new Twice({}, Object.create(null))).toThrow(/\[RMD056\]/);
    expect(() => new Twice({}, Object.create(null))).toThrow(/mounts ThemeProvider twice/);
    // The way out is in the message, not only in the docs.
    expect(() => new Twice({}, Object.create(null))).toThrow(/this\.props\.children/);
  });

  test("RMD056: the development report explains the throw, and names the component", async () => {
    const [ThemeProvider] = createContext({ theme: "light" }, { label: "Theme" });

    class Twice extends Component {
      first = this.use(ThemeProvider, () => ({ theme: "first" }));
      second = this.use(ThemeProvider, () => ({ theme: "second" }));
      render() {
        return <span>twice</span>;
      }
    }

    // The report is raised beside the throw, so it is on the channel even though nothing rendered.
    expect(() => new Twice({}, Object.create(null))).toThrow();
    expect(captured.codes).toContain("RMD056");
    expect(captured.messages.find((m) => m.includes("RMD056"))).toContain("<Twice /> uses ThemeProvider twice");
    await Promise.resolve();
  });

  /**
   * The arrangement that replaces it: one Provider per component, each handed the subtree it is for.
   *
   * It works because a context object is created from the component that RENDERS a node — so a child passed as `children` inherits the wrapper's
   * context rather than the context of whoever wrote the JSX. Measured here rather than asserted in
   * prose, because the whole refusal above rests on it.
   */
  test("RMD056: two scopes side by side are two contexts, with nothing passed down", async () => {
    const [ThemeProvider, ThemeConsumer] = createContext({ theme: "light" }, { label: "Theme" });

    class Reader extends Component {
      ctx = this.use(ThemeConsumer);
      render() {
        return <i class="read">{this.ctx.theme}</i>;
      }
    }

    class Scope extends Component<{ theme: string; children?: unknown }> {
      ctx = this.use(ThemeProvider, () => ({ theme: this.props.theme }));
      render() {
        return this.props.children as never;
      }
    }

    class App extends Component {
      render() {
        return (
          <div>
            <Scope theme="left">
              <Reader />
            </Scope>
            <Scope theme="right">
              <Reader />
            </Scope>
          </div>
        );
      }
    }

    const app = await getDOM<App>(<App />);
    await app.settle();

    expect([...document.querySelectorAll(".read")].map((node) => node.textContent)).toEqual(["left", "right"]);
    expect(captured.codes).not.toContain("RMD056");
  });

  test("RMD056: stays quiet for a NESTED provider, which is the ordinary case", async () => {
    const [ThemeProvider, ThemeConsumer] = createContext({ theme: "light" }, { label: "Theme" });

    class Reader extends Component {
      ctx = this.use(ThemeConsumer);
      render() {
        return <span class="read">{this.ctx.theme}</span>;
      }
    }

    /** Publishes on its OWN object, so the outer key is inherited here and never own. */
    class Inner extends Component {
      ctx = this.use(ThemeProvider, () => ({ theme: "inner" }));
      render() {
        return (
          <div>
            <Reader />
          </div>
        );
      }
    }

    class Outer extends Component {
      ctx = this.use(ThemeProvider, () => ({ theme: "outer" }));
      render() {
        return (
          <div>
            <Inner />
            <Reader />
          </div>
        );
      }
    }

    const app = await getDOM<Outer>(<Outer />);
    await app.settle();

    expect(captured.codes).not.toContain("RMD056");
    // And it really is shadowing rather than replacing: each branch reads its nearest.
    expect([...document.querySelectorAll(".read")].map((n) => n.textContent)).toEqual(["inner", "outer"]);
  });

  test("RMD056: stays quiet for two DIFFERENT contexts on one component", async () => {
    const [AProvider] = createContext({ a: 1 }, { label: "A" });
    const [BProvider] = createContext({ b: 2 }, { label: "B" });

    class Both extends Component {
      a = this.use(AProvider, () => ({ a: 1 }));
      b = this.use(BProvider, () => ({ b: 2 }));
      render() {
        return <span>both</span>;
      }
    }

    await getDOM<Both>(<Both />);

    expect(captured.codes).not.toContain("RMD056");
  });

  test("RMD057: reports a consumer declared above the provider on its own component", async () => {
    const [ThemeProvider, ThemeConsumer] = createContext({ theme: "light" }, { label: "Theme" });

    /** Consumer FIRST, so it resolves before this component's own publish exists. */
    class Middle extends Component {
      before = this.use(ThemeConsumer);
      own = this.use(ThemeProvider, () => ({ theme: "mine" }));
      render() {
        return <span id="before">{this.before.theme}</span>;
      }
    }

    class App extends Component {
      top = this.use(ThemeProvider, () => ({ theme: "ancestor" }));
      render() {
        return (
          <div>
            <Middle />
          </div>
        );
      }
    }

    const app = await getDOM<App>(<App />);
    await app.settle();

    expect(captured.codes).toContain("RMD057");
    expect(captured.messages.find((m) => m.includes("RMD057"))).toContain(
      "<Middle /> uses ThemeConsumer above ThemeProvider",
    );

    // What the report claims, measured: the consumer read the ANCESTOR, not the provider a line below it.
    expect(document.getElementById("before")?.textContent).toBe("ancestor");
  });

  test("RMD057: stays quiet for provide-then-use, which is what the packages are built around", async () => {
    const [ThemeProvider, ThemeConsumer] = createContext({ theme: "light" }, { label: "Theme" });

    /**
     * Provider FIRST. This is `this.use(QueryClientProvider)` followed by `this.use(Query, …)` —
     * mount a client, then query on it — and reporting it fired 14 times across query's own tests,
     * every one of them on the documented arrangement.
     */
    class Middle extends Component {
      own = this.use(ThemeProvider, () => ({ theme: "mine" }));
      after = this.use(ThemeConsumer);
      render() {
        return <span id="after">{this.after.theme}</span>;
      }
    }

    class App extends Component {
      top = this.use(ThemeProvider, () => ({ theme: "ancestor" }));
      render() {
        return (
          <div>
            <Middle />
          </div>
        );
      }
    }

    const app = await getDOM<App>(<App />);
    await app.settle();

    expect(captured.codes).not.toContain("RMD057");
    // And the silence is about this order specifically: it reads its OWN value, which is the point.
    expect(document.getElementById("after")?.textContent).toBe("mine");
  });

  test("RMD057: stays quiet when the consumer and the provider are on DIFFERENT components", async () => {
    const [ThemeProvider, ThemeConsumer] = createContext({ theme: "light" }, { label: "Theme" });

    class Reader extends Component {
      ctx = this.use(ThemeConsumer);
      render() {
        return <span id="read">{this.ctx.theme}</span>;
      }
    }

    class App extends Component {
      top = this.use(ThemeProvider, () => ({ theme: "ancestor" }));
      render() {
        return (
          <div>
            <Reader />
          </div>
        );
      }
    }

    const app = await getDOM<App>(<App />);
    await app.settle();

    expect(captured.codes).not.toContain("RMD057");
    expect(document.getElementById("read")?.textContent).toBe("ancestor");
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
      @created start() {
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

  test("RMD006: stays quiet when @destroyed clears the timer", async () => {
    class Clock extends Component {
      private timerId: ReturnType<typeof setInterval> | undefined;
      @created start() {
        this.timerId = setInterval(() => {}, 10_000);
      }
      @destroyed stop() {
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
      @created start() {
        setInterval(() => {}, 10_000);
      }
      render() {
        return <span>child</span>;
      }
    }
    class Parent extends Component {
      @state showChild = true;
      // Runs after the child is built — must not inherit the child's ownership.
      @mounted fine() {}
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
