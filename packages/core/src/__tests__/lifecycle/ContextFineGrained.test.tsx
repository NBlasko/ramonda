import { describe, test, expect, beforeEach } from "vitest";
import { getDOM } from "../../test/setup";
import { state } from "../../base/decorators";
import { Component } from "../../base/Component";
import { createContext } from "../../base/Context";

let log: string[] = [];

beforeEach(() => {
  log = [];
});

describe("Context: per-key fine-grained updates", () => {
  test("changing one key re-renders only consumers of THAT key", async () => {
    const [Provider, Ctx] = createContext({ a: 0, b: 0 });

    class AReader extends Component {
      ctx = this.use(Ctx);
      render() {
        log.push(`A:${this.ctx.a}`);
        return <div id="a">{this.ctx.a}</div>;
      }
    }

    class BReader extends Component {
      ctx = this.use(Ctx);
      render() {
        log.push(`B:${this.ctx.b}`);
        return <div id="b">{this.ctx.b}</div>;
      }
    }

    class Root extends Component {
      @state a = 0;
      @state b = 0;
      ctx = this.use(Provider, () => ({ a: this.a, b: this.b }));
      render() {
        return (
          <div>
            <AReader />
            <BReader />
          </div>
        );
      }
    }

    using app = await getDOM<Root>(<Root />);
    const { instance, settle } = app;

    expect(log).toContain("A:0");
    expect(log).toContain("B:0");
    log = [];

    // Change only `a` → only AReader reacts.
    instance.a = 1;
    await settle();
    expect(log).toEqual(["A:1"]);
    expect(document.getElementById("a")?.textContent).toBe("1");
    log = [];

    // Change only `b` → only BReader reacts.
    instance.b = 5;
    await settle();
    expect(log).toEqual(["B:5"]);
    expect(document.getElementById("b")?.textContent).toBe("5");
  });

  test("a consumer that never reads a key does not subscribe to it (lazy)", async () => {
    const [Provider, Ctx] = createContext({ a: 0, b: 0 });

    // Reads ONLY `a` — must be inert to `b` changes.
    class OnlyA extends Component {
      ctx = this.use(Ctx);
      render() {
        log.push(`OnlyA:${this.ctx.a}`);
        return <div>{this.ctx.a}</div>;
      }
    }

    class Root extends Component {
      @state a = 0;
      @state b = 0;
      ctx = this.use(Provider, () => ({ a: this.a, b: this.b }));
      render() {
        return (
          <div>
            <OnlyA />
          </div>
        );
      }
    }

    using app = await getDOM<Root>(<Root />);
    const { instance, settle } = app;

    expect(log).toEqual(["OnlyA:0"]);
    log = [];

    // `b` changes → OnlyA never read `b`, so it must not re-render.
    instance.b = 99;
    await settle();
    expect(log).toEqual([]);

    // `a` changes → it does re-render.
    instance.a = 1;
    await settle();
    expect(log).toEqual(["OnlyA:1"]);
  });

  test("multiple consumers of the same key all update", async () => {
    const [Provider, Ctx] = createContext({ n: 0 });

    class Reader extends Component<{ tag: string }> {
      ctx = this.use(Ctx);
      render() {
        log.push(`${this.props.tag}:${this.ctx.n}`);
        return <div>{this.ctx.n}</div>;
      }
    }

    class Root extends Component {
      @state n = 0;
      ctx = this.use(Provider, () => ({ n: this.n }));
      render() {
        return (
          <div>
            <Reader tag="R1" />
            <Reader tag="R2" />
          </div>
        );
      }
    }

    using app = await getDOM<Root>(<Root />);
    const { instance, settle } = app;
    log = [];

    instance.n = 7;
    await settle();

    expect(log).toContain("R1:7");
    expect(log).toContain("R2:7");
    expect(log).toHaveLength(2);
  });
});

describe("Context: provider as reader (no double render)", () => {
  test("providing component reads its own value and renders once per change", async () => {
    const [Provider] = createContext({ color: "blue" });

    class Panel extends Component {
      @state color = "blue";
      provided = this.use(Provider, () => ({ color: this.color }));
      render() {
        log.push(`Panel:${this.provided.color}`);
        return <div id="panel">{this.provided.color}</div>;
      }
    }

    using app = await getDOM<Panel>(<Panel />);
    const { instance, settle } = app;

    expect(log).toEqual(["Panel:blue"]);
    log = [];

    // Self-update: the reader reads options directly (fresh before render),
    // so this must be a SINGLE render with the new value — no effect round-trip.
    instance.color = "red";
    await settle();

    expect(log).toEqual(["Panel:red"]);
    expect(document.getElementById("panel")?.textContent).toBe("red");
  });

  test("providing component and its descendants both see the value", async () => {
    const [Provider, Ctx] = createContext({ color: "blue" });

    class Child extends Component {
      ctx = this.use(Ctx);
      render() {
        return <span id="child">{this.ctx.color}</span>;
      }
    }

    class Panel extends Component {
      @state color = "green";
      provided = this.use(Provider, () => ({ color: this.color }));
      render() {
        return (
          <div id="panel">
            {this.provided.color}
            <Child />
          </div>
        );
      }
    }

    using app = await getDOM<Panel>(<Panel />);
    const { instance, settle } = app;

    expect(document.getElementById("panel")?.textContent).toContain("green");
    expect(document.getElementById("child")?.textContent).toBe("green");

    instance.color = "purple";
    await settle();

    expect(document.getElementById("child")?.textContent).toBe("purple");
  });
});

describe("Context: edge cases", () => {
  test("consumer with no provider up the tree falls back to defaultValue", async () => {
    const [, Ctx] = createContext({ val: "fallback" });

    class Lonely extends Component {
      ctx = this.use(Ctx);
      render() {
        return <div id="lonely">{this.ctx.val}</div>;
      }
    }

    using app = await getDOM(<Lonely />);
    await app.settle();

    expect(document.getElementById("lonely")?.textContent).toBe("fallback");
  });

  test("two independent contexts do not interfere", async () => {
    const [ProviderA, CtxA] = createContext({ x: "a0" });
    const [ProviderB, CtxB] = createContext({ y: "b0" });

    class Child extends Component {
      a = this.use(CtxA);
      b = this.use(CtxB);
      render() {
        log.push(`C:${this.a.x}|${this.b.y}`);
        return (
          <div id="child">
            {this.a.x}
            {this.b.y}
          </div>
        );
      }
    }

    class Root extends Component {
      @state x = "a0";
      @state y = "b0";
      a = this.use(ProviderA, () => ({ x: this.x }));
      b = this.use(ProviderB, () => ({ y: this.y }));
      render() {
        return <Child />;
      }
    }

    using app = await getDOM<Root>(<Root />);
    const { instance, settle } = app;

    expect(log).toContain("C:a0|b0");
    log = [];

    instance.x = "a1";
    await settle();
    expect(document.getElementById("child")?.textContent).toBe("a1b0");

    instance.y = "b1";
    await settle();
    expect(document.getElementById("child")?.textContent).toBe("a1b1");
  });

  test("a deeply nested consumer reads and reacts to context", async () => {
    const [Provider, Ctx] = createContext({ theme: "light" });

    class Leaf extends Component {
      ctx = this.use(Ctx);
      render() {
        log.push(`Leaf:${this.ctx.theme}`);
        return <div id="leaf">{this.ctx.theme}</div>;
      }
    }
    class Level3 extends Component {
      render() {
        return <Leaf />;
      }
    }
    class Level2 extends Component {
      render() {
        return <Level3 />;
      }
    }
    class Level1 extends Component {
      render() {
        return <Level2 />;
      }
    }

    class Root extends Component {
      @state theme = "light";
      ctx = this.use(Provider, () => ({ theme: this.theme }));
      render() {
        return <Level1 />;
      }
    }

    using app = await getDOM<Root>(<Root />);
    const { instance, settle } = app;

    expect(document.getElementById("leaf")?.textContent).toBe("light");
    log = [];

    instance.theme = "dark";
    await settle();

    expect(log).toEqual(["Leaf:dark"]);
    expect(document.getElementById("leaf")?.textContent).toBe("dark");
  });
});
