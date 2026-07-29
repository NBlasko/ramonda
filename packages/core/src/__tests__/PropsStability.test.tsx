import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { getDOM } from "../test/setup";
import { Component } from "../base/Component";
import { Hook } from "../base/Hook";
import { compute, memoizedHandler, state, watchProp } from "../base/decorators";
import { stable } from "../base/stable";
import { stableProps } from "../base/decorators";
import { configureDev } from "../config";
import { resetDiagnostics } from "../debug/diagnostics";

/**
 * RMD022 — a hook's props callback called twice, and the two bags compared.
 *
 * The same check RMD020 runs on `render()`, on the other place the framework asks the app
 * for a value on every render. `stable()` is the fix it names for arrays and objects, and
 * a bound method is the fix for functions — so these tests carry both halves: what is
 * reported, and that the recommended form is silent AND actually stable at runtime.
 */

let logs: string[] = [];

beforeEach(() => {
  resetDiagnostics();
  configureDev({ strictRender: true });
  logs = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  configureDev({ strictRender: false });
});

function reported(): string {
  return logs.join("\n");
}

interface Bag {
  key?: readonly unknown[];
  filter?: Record<string, unknown>;
  fetch?: () => unknown;
  count?: number;
}

class Probe extends Hook<Bag> {
  keys: unknown[] = [];

  /** `props` is protected, so a test reads what it needs through a getter. */
  get count(): number | undefined {
    return this.props.count;
  }

  /** Reads the props, so the signals exist and a rebuilt value really does wake one. */
  @compute get seen(): string {
    this.keys.push(this.props.key);
    return JSON.stringify(this.props.key ?? null);
  }
}

describe("RMD022", () => {
  test("an array literal in a bag is reported, and named by its prop", async () => {
    class Panel extends Component {
      probe = this.use(Probe, () => ({ key: ["user", 1] }));
      render() {
        return <div>{this.probe.seen}</div>;
      }
    }

    await getDOM<Panel>(<Panel />);

    expect(reported()).toContain("RMD022");
    expect(reported()).toContain("Panel → Probe");
    expect(reported()).toContain("`key`");
    expect(reported()).toContain("stable(");
  });

  test("a closure in a bag is reported as a function, with the bound-method fix", async () => {
    class Panel extends Component {
      probe = this.use(Probe, (self: Panel) => ({ fetch: () => self.constructor.name }));
      render() {
        return <div>ok</div>;
      }
    }

    await getDOM<Panel>(<Panel />);

    expect(reported()).toContain("builds a new function for the `fetch` prop");
    expect(reported()).toContain("bound method");
  });

  test("stable() silences it — and hands back ONE array across renders", async () => {
    class Panel extends Component {
      @state unrelated = 0;
      probe = this.use(Probe, (self: Panel) => ({ key: stable(["user", self.unrelated > 5 ? 2 : 1]) }));
      render() {
        return <div>{`${this.probe.seen}:${this.unrelated}`}</div>;
      }
    }

    const { instance, settle } = await getDOM<Panel>(<Panel />);
    instance.unrelated = 1;
    await settle();
    instance.unrelated = 2;
    await settle();

    expect(reported()).not.toContain("RMD022");
    // Three renders, one array — the promise, not just the silence.
    expect(instance.probe.keys.length).toBe(1);
    expect(instance.probe.keys[0]).toEqual(["user", 1]);

    // And it still follows its contents.
    instance.unrelated = 9;
    await settle();
    expect(instance.probe.keys.length).toBe(2);
    expect(instance.probe.keys[1]).toEqual(["user", 2]);
  });

  test("stable() compares nested contents, not just the top level", async () => {
    class Panel extends Component {
      @state page = 1;
      @state unrelated = 0;
      probe = this.use(Probe, (self: Panel) => ({ key: stable(["posts", { page: self.page, tag: "a" }]) }));
      render() {
        return <div>{`${this.probe.seen}:${this.unrelated}`}</div>;
      }
    }

    const { instance, settle } = await getDOM<Panel>(<Panel />);
    instance.unrelated = 1;
    await settle();
    expect(instance.probe.keys.length).toBe(1);

    instance.page = 2;
    await settle();
    expect(instance.probe.keys.length).toBe(2);
    expect(reported()).not.toContain("RMD022");
  });

  test("a bound method is stable without stable()", async () => {
    class Panel extends Component {
      load() {
        return "loaded";
      }
      probe = this.use(Probe, (self: Panel) => ({ fetch: self.load }));
      render() {
        return <div>ok</div>;
      }
    }

    await getDOM<Panel>(<Panel />);
    expect(reported()).not.toContain("RMD022");
  });

  test("@memoizedHandler in a bag is stable for the same arguments", async () => {
    class Panel extends Component {
      @state picked = "";

      @memoizedHandler
      choose(id: string) {
        return () => {
          this.picked = id;
        };
      }

      probe = this.use(Probe, (self: Panel) => ({ fetch: self.choose("a") }));
      render() {
        return <div>{this.picked}</div>;
      }
    }

    await getDOM<Panel>(<Panel />);
    expect(reported()).not.toContain("RMD022");
  });

  test("a @compute bag is silent — every value in it at once", async () => {
    class Panel extends Component {
      @state id = 1;

      @compute get bag(): Bag {
        return { key: ["user", this.id], fetch: () => this.id };
      }

      probe = this.use(Probe, (self: Panel) => self.bag);
      render() {
        return <div>{this.probe.seen}</div>;
      }
    }

    await getDOM<Panel>(<Panel />);
    expect(reported()).not.toContain("RMD022");
  });

  test("different CONTENTS from two calls in one tick is reported as non-determinism", async () => {
    let n = 0;
    class Panel extends Component {
      probe = this.use(Probe, () => ({ count: n++ }));
      render() {
        return <div>{String(this.probe.count)}</div>;
      }
    }

    await getDOM<Panel>(<Panel />);

    expect(reported()).toContain("does not come from state");
    expect(reported()).toContain("`count`");
  });

  test("stable() with different contents in one tick is still reported", async () => {
    let n = 0;
    class Panel extends Component {
      probe = this.use(Probe, () => ({ key: stable(["row", n++]) }));
      render() {
        return <div>{this.probe.seen}</div>;
      }
    }

    await getDOM<Panel>(<Panel />);

    // The marker cannot hide it: what is compared is the contents, not the wrapper.
    expect(reported()).toContain("RMD022");
    expect(reported()).toContain("does not come from state");
  });

  test("a scalar prop that moves between renders is NOT reported", async () => {
    class Panel extends Component {
      @state id = 1;
      probe = this.use(Probe, (self: Panel) => ({ count: self.id }));
      render() {
        return <div>{String(this.probe.count)}</div>;
      }
    }

    const { instance, settle } = await getDOM<Panel>(<Panel />);
    instance.id = 2;
    await settle();

    // The two calls are in the same tick, so a real change never looks like instability.
    expect(reported()).not.toContain("RMD022");
  });

  test("the switch turns it off with the double render", async () => {
    configureDev({ strictRender: false });

    let calls = 0;
    class Panel extends Component {
      probe = this.use(Probe, () => {
        calls++;
        return { key: ["user", 1] };
      });
      render() {
        return <div>{this.probe.seen}</div>;
      }
    }

    await getDOM<Panel>(<Panel />);

    expect(reported()).not.toContain("RMD022");
    expect(calls).toBe(1);
  });

  test("stable() keeps @watchProp from firing on an unchanged key", async () => {
    let fired = 0;
    class Watcher extends Hook<{ key: readonly unknown[] }> {
      @watchProp((p: { key: readonly unknown[] }) => p.key)
      onKey() {
        fired++;
      }
    }
    class Panel extends Component {
      @state unrelated = 0;
      w = this.use(Watcher, (self: Panel) => ({ key: stable(["user", 1, self.unrelated > 5]) }));
      render() {
        return <div>{String(this.unrelated)}</div>;
      }
    }

    const { instance, settle } = await getDOM<Panel>(<Panel />);
    instance.unrelated = 1;
    await settle();
    instance.unrelated = 2;
    await settle();

    // The measured motive for the whole feature: without stable() this fires on every
    // update render, and a post-commit watcher would then loop.
    expect(fired).toBe(0);

    instance.unrelated = 9;
    await settle();
    expect(fired).toBe(1);
  });
});

describe("static stableProps — the hook declares it, the call site does not", () => {
  /**
   * The DX question this answers: a query key is a value, and the hook AUTHOR knows that.
   * Making every call site wrap it in `stable()` puts the hook's own semantics in the
   * app's code. So a hook declares which props are values, the app writes the natural
   * literal, and the framework holds the identity — `stable()` stays for hooks that
   * declared nothing.
   */
  @stableProps("key")
  class Declared extends Hook<Bag> {
    keys: unknown[] = [];

    @compute get seen(): string {
      this.keys.push(this.props.key);
      return JSON.stringify(this.props.key ?? null);
    }
  }

  test("a plain array literal gets one identity, and no report", async () => {
    class Panel extends Component {
      @state page = 1;
      @state unrelated = 0;
      probe = this.use(Declared, (self: Panel) => ({ key: ["posts", { page: self.page }] }));
      render() {
        return <div>{`${this.probe.seen}:${this.unrelated}`}</div>;
      }
    }

    const { instance, settle } = await getDOM<Panel>(<Panel />);
    instance.unrelated = 1;
    await settle();
    instance.unrelated = 2;
    await settle();

    // Three renders, one array — with no `stable()` anywhere at the call site.
    expect(instance.probe.keys.length).toBe(1);
    expect(reported()).not.toContain("RMD022");

    // And it still follows its contents, nested object included.
    instance.page = 2;
    await settle();
    expect(instance.probe.keys.length).toBe(2);
    expect(instance.probe.keys[1]).toEqual(["posts", { page: 2 }]);
  });

  test("a prop it did NOT declare is still reported", async () => {
    class Panel extends Component {
      probe = this.use(Declared, () => ({ key: ["posts"], filter: { tag: "a" } }));
      render() {
        return <div>{this.probe.seen}</div>;
      }
    }

    await getDOM<Panel>(<Panel />);

    // The declaration is per prop, not a blanket exemption.
    expect(reported()).toContain("RMD022");
    expect(reported()).toContain("`filter`");
    expect(reported()).not.toContain("`key`");
  });

  test("a function cannot be declared away — it is still reported", async () => {
    // A hook author cannot make a closure comparable by saying so: two closures with the
    // same body are not equal by any comparison that is safe to make.
    @stableProps("key", "fetch")
    class Fn extends Hook<Bag> {
      get seen(): string {
        return String(this.props.fetch?.());
      }
    }

    class Panel extends Component {
      probe = this.use(Fn, (self: Panel) => ({ fetch: () => self.constructor.name }));
      render() {
        return <div>{this.probe.seen}</div>;
      }
    }

    await getDOM<Panel>(<Panel />);
    expect(reported()).toContain("builds a new function for the `fetch` prop");
  });
});

describe("@stableProps is type-checked at the decoration site", () => {
  /**
   * The names are checked against the hook's OWN props, with no type argument written at
   * the call site. `C` is inferred from the decorated class and the keys are compared
   * through `keyof`, so an optional prop counts as a prop and a typo does not.
   *
   * These cases only have to COMPILE (or fail to), which `@ts-expect-error` asserts —
   * there is nothing to run.
   */
  interface Shape {
    key: readonly unknown[];
    filter?: Record<string, unknown>;
  }

  test("a real prop name compiles, a typo does not", () => {
    @stableProps("key")
    class Fine extends Hook<Shape> {}

    // An OPTIONAL prop is still a prop — checked through `keyof`, not by assignability.
    @stableProps("key", "filter")
    class Both extends Hook<Shape> {}

    // @ts-expect-error — "kye" is not a prop of Shape, and the error names it.
    @stableProps("kye")
    class Typo extends Hook<Shape> {}

    expect([Fine, Both, Typo].length).toBe(3);
  });

  test("a component is rejected twice over: by the compiler, and at decoration time", () => {
    expect(() => {
      // @ts-expect-error — a component instance is not structurally a hook (no
      // HOOK_RUNTIME), which is what makes this a compile error and not just a runtime one.
      @stableProps("key")
      class NotAHook extends Component<Shape> {
        render() {
          return <div />;
        }
      }
      return NotAHook;
      // The throw is the backstop for a build with no types, and it points at the
      // mechanism a component actually has.
    }).toThrow(/@stableProps is for hooks, not components/);
  });

  test("a hook with no props rejects any name", () => {
    // @ts-expect-error — nothing to declare on a hook that takes no props.
    @stableProps("key")
    class NoProps extends Hook {}

    expect(NoProps).toBeTypeOf("function");
  });
});

describe("stableProps is a property of the KIND, not of an instance", () => {
  @stableProps("key")
  class Base extends Hook<Bag> {
    keys: unknown[] = [];

    @compute get seen(): string {
      this.keys.push(this.props.key);
      return JSON.stringify(this.props.key ?? null);
    }
  }

  test("a subclass inherits the declaration without repeating it", async () => {
    class Special extends Base {}

    class Panel extends Component {
      @state unrelated = 0;
      probe = this.use(Special, () => ({ key: ["a", 1] }));
      render() {
        return <div>{`${this.probe.seen}:${this.unrelated}`}</div>;
      }
    }

    const { instance, settle } = await getDOM<Panel>(<Panel />);
    instance.unrelated = 1;
    await settle();

    // A static lives on the constructor, and `extends` chains constructors — so this
    // needs no `[...Base.stableProps]` ceremony.
    expect(instance.probe.keys.length).toBe(1);
    expect(reported()).not.toContain("RMD022");
  });

  test("a subclass declaring more keeps what the parent declared", async () => {
    // A subclass declaring MORE. The decorator merges with what the parent declared
    // rather than replacing it, so `key` cannot be dropped by forgetting to spread it —
    // which is exactly what a `static` field would have done.
    @stableProps("filter")
    class Adding extends Base {}

    class Panel extends Component {
      @state unrelated = 0;
      probe = this.use(Adding, () => ({ key: ["a", 1], filter: { tag: "x" } }));
      render() {
        return <div>{`${this.probe.seen}:${this.unrelated}`}</div>;
      }
    }

    const { instance, settle } = await getDOM<Panel>(<Panel />);
    instance.unrelated = 1;
    await settle();

    // Both are held: the parent's `key` and the subclass's `filter`.
    expect(instance.probe.keys.length).toBe(1);
    expect(reported()).not.toContain("RMD022");
  });

  test("two different hook classes do not share a declaration", async () => {
    class Undeclared extends Hook<Bag> {
      keys: unknown[] = [];
      @compute get seen(): string {
        this.keys.push(this.props.key);
        return String(this.props.key?.length ?? 0);
      }
    }

    class Panel extends Component {
      declared = this.use(Base, () => ({ key: ["a"] }));
      plain = this.use(Undeclared, () => ({ key: ["a"] }));
      render() {
        return <div>{`${this.declared.seen}:${this.plain.seen}`}</div>;
      }
    }

    await getDOM<Panel>(<Panel />);

    // Read from the same bag shape, in the same component: only the hook that declared
    // `key` is exempt. A static is per class, not a global switch.
    expect(reported()).toContain("Panel → Undeclared");
    expect(reported()).not.toContain("Panel → Base");
  });
});
