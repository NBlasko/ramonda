import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { getDOM } from "../../test/setup";
import { Component, Host, state, createContext } from "../../index";
import { resetDiagnostics } from "../../debug/diagnostics";

/**
 * Context publishes ONE SIGNAL PER KEY, which is where its behaviour differs
 * from the obvious implementation: a consumer that reads one key is not woken by
 * another changing, and a nested provider shadows an outer one for its subtree
 * only.
 */
describe("context", () => {
  const codes: string[] = [];
  const handler = (e: Event) => {
    const m = (e as CustomEvent).detail?.message as string;
    const c = m?.match(/^\[(RMD\d+)\]/)?.[1];
    if (c) codes.push(c);
  };
  beforeEach(() => {
    codes.length = 0;
    resetDiagnostics();
    window.addEventListener("ramonda:dev-log", handler);
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    window.removeEventListener("ramonda:dev-log", handler);
    vi.restoreAllMocks();
  });

  test("a consumer re-renders only for the key it actually reads", async () => {
    const [P, C] = createContext({ a: "a0", b: "b0" });
    let renders = 0;
    @Host("div")
    class OnlyA extends Component {
      ctx = this.use(C);
      render() {
        renders++;
        return <span>{this.ctx.a}</span>;
      }
    }
    @Host("div")
    class App extends Component {
      @state a = "a0";
      @state b = "b0";
      p = this.use(P, () => ({ a: this.a, b: this.b }));
      render() {
        return (
          <div>
            {this.b}
            <OnlyA />
          </div>
        );
      }
    }
    const app = await getDOM<App>(<App />);
    await app.settle();
    const base = renders;
    app.instance.b = "b1";
    await app.settle();
    // `b` changed and the providing component re-rendered, but this consumer
    // never reads `b`, so it is not woken.
    expect(renders).toBe(base);

    app.instance.a = "a1";
    await app.settle();
    expect(renders).toBe(base + 1);
  });

  test("a nested provider shadows the outer one for its subtree only", async () => {
    const [P, C] = createContext({ v: "default" });
    @Host("div")
    class Leaf extends Component {
      ctx = this.use(C);
      render() {
        return <span>{this.ctx.v}</span>;
      }
    }
    @Host("div")
    class Inner extends Component {
      @state v = "inner";
      p = this.use(P, () => ({ v: this.v }));
      render() {
        return <Leaf />;
      }
    }
    @Host("div")
    class Outer extends Component {
      @state v = "outer";
      p = this.use(P, () => ({ v: this.v }));
      render() {
        return (
          <div>
            <Leaf />
            <Inner />
          </div>
        );
      }
    }
    const app = await getDOM<Outer>(<Outer />);
    await app.settle();
    expect(app.container.textContent).toBe("outerinner");

    app.instance.v = "outer2";
    await app.settle();
    expect(app.container.textContent).toBe("outer2inner");
  });

  test("with no provider anywhere, the default is used and reported", async () => {
    const [, C] = createContext({ v: "fallback" }, { label: "Solo" });
    @Host("div")
    class Leaf extends Component {
      ctx = this.use(C);
      render() {
        return <span>{this.ctx.v}</span>;
      }
    }
    const app = await getDOM<Leaf>(<Leaf />);
    await app.settle();
    expect(app.container.textContent).toBe("fallback");
    expect(codes).toContain("RMD003");
  });

  test("holding a consumer without reading it is not a mistake", async () => {
    const [, C] = createContext({ v: "fallback" });
    @Host("div")
    class Leaf extends Component {
      ctx = this.use(C);
      @state show = false;
      render() {
        return <span>{this.show ? this.ctx.v : "quiet"}</span>;
      }
    }
    const app = await getDOM<Leaf>(<Leaf />);
    await app.settle();
    // Reported on READ, not on construction: a hook may hold a consumer it only
    // reads down some branches.
    expect(codes).toEqual([]);
  });

  test("a key the provider does not supply falls back to the default", async () => {
    const [P, C] = createContext({ a: "da", b: "db" });
    @Host("div")
    class Leaf extends Component {
      ctx = this.use(C);
      render() {
        return (
          <span>
            {String(this.ctx.a)}/{String(this.ctx.b)}
          </span>
        );
      }
    }
    @Host("div")
    class App extends Component {
      // `b` is never provided.
      p = this.use(P, () => ({ a: "provided" }) as never);
      render() {
        return <Leaf />;
      }
    }
    const app = await getDOM<App>(<App />);
    await app.settle();
    // Measured before the fix: "provided/undefined". Reading the key through
    // the options proxy created a signal holding `undefined`, so the declared
    // default was unreachable and the fallback in the consumer was dead code.
    expect(app.container.textContent).toBe("provided/db");
  });

  test("an explicitly provided undefined is not replaced by the default", async () => {
    const [P, C] = createContext({ v: "fallback" });
    @Host("div")
    class Leaf extends Component {
      ctx = this.use(C);
      render() {
        return <span>{String(this.ctx.v)}</span>;
      }
    }
    @Host("div")
    class App extends Component {
      p = this.use(P, () => ({ v: undefined as never }));
      render() {
        return <Leaf />;
      }
    }
    const app = await getDOM<App>(<App />);
    await app.settle();
    // The key IS present, so the provider means it.
    expect(app.container.textContent).toBe("undefined");
  });

  test("the label names both hooks for the devtools tree", async () => {
    const [P, C] = createContext({ v: 1 }, { label: "Theme" });
    expect((P as unknown as { name: string }).name).toBe("ThemeProvider");
    expect((C as unknown as { name: string }).name).toBe("ThemeConsumer");

    const [P2] = createContext({ v: 1 });
    expect((P2 as unknown as { name: string }).name).toBe("Provider");
  });

  test("a value that becomes undefined propagates as undefined", async () => {
    const [P, C] = createContext<{ v: string | undefined }>({ v: "default" });
    let renders = 0;
    @Host("div")
    class Leaf extends Component {
      ctx = this.use(C);
      render() {
        renders++;
        return <span>[{String(this.ctx.v)}]</span>;
      }
    }
    @Host("div")
    class App extends Component {
      @state v: string | undefined = "start";
      p = this.use(P, () => ({ v: this.v }));
      render() {
        return <Leaf />;
      }
    }
    const app = await getDOM<App>(<App />);
    await app.settle();
    expect(app.container.textContent).toBe("[start]");
    const before = renders;

    app.instance.v = undefined;
    await app.settle();
    // undefined is a value like any other: the consumer is woken and sees it.
    // It is NOT swapped for the declared default — that only happens when the
    // provider omits the key entirely. Note this differs from JS convention,
    // where `f(undefined)` does trigger a default parameter.
    expect(renders).toBe(before + 1);
    expect(app.container.textContent).toBe("[undefined]");

    app.instance.v = "back";
    await app.settle();
    expect(app.container.textContent).toBe("[back]");
  });

  test("undefined from the very first render still leaves a live channel", async () => {
    const [P, C] = createContext<{ v: string | undefined }>({ v: "default" });
    @Host("div")
    class Leaf extends Component {
      ctx = this.use(C);
      render() {
        return <span>[{String(this.ctx.v)}]</span>;
      }
    }
    @Host("div")
    class App extends Component {
      @state v: string | undefined = undefined;
      p = this.use(P, () => ({ v: this.v }));
      render() {
        return <Leaf />;
      }
    }
    const app = await getDOM<App>(<App />);
    await app.settle();
    expect(app.container.textContent).toBe("[undefined]");
    app.instance.v = "later";
    await app.settle();
    expect(app.container.textContent).toBe("[later]");
  });
});
