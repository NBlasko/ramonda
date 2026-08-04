import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { getDOM } from "../test/setup";
import { Component } from "../base/Component";
import { Hook } from "../base/Hook";
import { compute, memoizedHandler, state, watchProp } from "../base/decorators";
import { StableProps } from "../base/decorators";
import { configureDev } from "../config";
import { resetDiagnostics } from "../debug/diagnostics";

/**
 * RMD022 — a hook's props callback called twice, and the two bags compared.
 *
 * The same check RMD020 runs on `render()`, on the other place the framework asks the app
 * for a value on every render. Holding the value somewhere that HAS an identity is the fix it
 * names for arrays and objects — a `@compute`, a field, a module constant — and a bound method is
 * the fix for functions. So these tests carry both halves: what is reported, and that the
 * recommended form is silent AND actually stable at runtime.
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

/**
 * Drives an owner through enough renders for the run counter to speak.
 *
 * RMD022 reports on the fourth consecutive rebuild (`RUNS` in `debug/propsStability.ts`), so a
 * test that mounts and stops proves nothing. And a props callback has to be INVALIDATED to run at
 * all — it is cached on the signals it reads — which is why every bag below carries a `count` that
 * moves alongside the value being examined.
 *
 * That pairing is not scaffolding around the check. It is the condition the check now describes:
 * a callback that keeps running for a good reason, rebuilding one value that never moves.
 */
async function churn(app: { instance: { tick: number }; settle: () => Promise<void> }): Promise<void> {
  for (let i = 1; i <= 3; i++) {
    app.instance.tick = i;
    await app.settle();
  }
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
      @state tick = 0;
      probe = this.use(Probe, (self: Panel) => ({ key: ["user", 1], count: self.tick }));
      render() {
        return <div>{this.probe.seen}</div>;
      }
    }

    await churn(await getDOM<Panel>(<Panel />));

    expect(reported()).toContain("RMD022");
    expect(reported()).toContain("Panel → Probe");
    expect(reported()).toContain("`key`");
    expect(reported()).toContain("@compute");
  });

  test("a closure in a bag is reported as a function, with the bound-method fix", async () => {
    class Panel extends Component {
      @state tick = 0;
      probe = this.use(Probe, (self: Panel) => ({ fetch: () => self.constructor.name, count: self.tick }));
      render() {
        return <div>ok</div>;
      }
    }

    await churn(await getDOM<Panel>(<Panel />));

    expect(reported()).toContain("new function for the `fetch` prop");
    expect(reported()).toContain("bound method");
  });

  test("a @compute holding the value silences it — and hands back ONE array across renders", async () => {
    // The call-site fix for a hook that declared nothing: hold the value somewhere that HAS an
    // identity, and the bag receives the same one instead of a fresh one.
    class Panel extends Component {
      @state id = 1;
      @state unrelated = 0;

      @compute get key(): readonly unknown[] {
        return ["user", this.id];
      }

      probe = this.use(Probe, (self: Panel) => ({ key: self.key }));
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

    // And it still follows what it was derived from.
    instance.id = 2;
    await settle();
    expect(instance.probe.keys.length).toBe(2);
    expect(instance.probe.keys[1]).toEqual(["user", 2]);
  });

  test("a @compute follows its DEPENDENCIES, not its contents — which is the hook's job to absorb", async () => {
    /**
     * The one thing the call site cannot do for itself, written down rather than left to be
     * rediscovered.
     *
     * A `@compute` is invalidated by the signals it READ, so one whose answer is coarser than its
     * inputs — `this.noise > 5`, `items.length`, `id ?? 0` — rebuilds its value whenever those
     * inputs move, even though the answer did not. Splitting it into two computes does not help:
     * invalidation propagates, it is not deduplicated by value. RMD024 is the report for it.
     *
     * That is deliberate, and the reason there is no wrapper for it: absorbing it belongs to the
     * HOOK. `Query.onKeyChanged` is the worked example — it compares the key part by part before
     * doing anything, "even though the framework already did". A hook written that way is immune
     * to this; a hook that is not has a problem a call-site wrapper would only hide, and hide
     * inconsistently, since any such comparison has to be bounded to be affordable.
     */
    class Panel extends Component {
      @state noise = 0;

      @compute get key(): readonly unknown[] {
        return ["user", this.noise > 5 ? 2 : 1];
      }

      probe = this.use(Probe, (self: Panel) => ({ key: self.key }));
      render() {
        return <div>{`${this.probe.seen}:${this.noise}`}</div>;
      }
    }

    const { instance, settle } = await getDOM<Panel>(<Panel />);
    instance.noise = 1;
    await settle();
    instance.noise = 2;
    await settle();

    // A fresh array each time, with the same contents — and no report, because the callback did
    // not build it: it handed over what the compute produced.
    expect(instance.probe.keys.length).toBe(3);
    expect(instance.probe.keys).toEqual([
      ["user", 1],
      ["user", 1],
      ["user", 1],
    ]);
    expect(reported()).not.toContain("RMD022");
  });

  test("a @compute follows a nested value, and nothing else", async () => {
    class Panel extends Component {
      @state page = 1;
      @state unrelated = 0;

      @compute get key(): readonly unknown[] {
        return ["posts", { page: this.page, tag: "a" }];
      }

      probe = this.use(Probe, (self: Panel) => ({ key: self.key }));
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

  test("a bound method needs nothing at all", async () => {
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

  test("an array whose CONTENTS move between two calls in one tick is reported", async () => {
    let n = 0;
    class Panel extends Component {
      probe = this.use(Probe, () => ({ key: ["row", n++] }));
      render() {
        return <div>{this.probe.seen}</div>;
      }
    }

    await getDOM<Panel>(<Panel />);

    // Not "rebuilt in place" but "does not come from state" — nothing can launder that, because
    // what is compared is the contents.
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

  test("a declared prop keeps @watchProp from firing on an unchanged key", async () => {
    let fired = 0;
    @StableProps("key")
    class Watcher extends Hook<{ key: readonly unknown[] }> {
      @watchProp((p: { key: readonly unknown[] }) => p.key)
      onKey() {
        fired++;
      }
    }
    class Panel extends Component {
      @state unrelated = 0;
      w = this.use(Watcher, (self: Panel) => ({ key: ["user", 1, self.unrelated > 5] }));
      render() {
        return <div>{String(this.unrelated)}</div>;
      }
    }

    const { instance, settle } = await getDOM<Panel>(<Panel />);
    instance.unrelated = 1;
    await settle();
    instance.unrelated = 2;
    await settle();

    // The measured motive for the whole feature: without the declaration this fires on every
    // update render, and a post-commit watcher would then loop.
    expect(fired).toBe(0);

    instance.unrelated = 9;
    await settle();
    expect(fired).toBe(1);
  });
});

/**
 * The run counter, which is what separates "built in place" from "built in place for nothing".
 *
 * The same-tick pair proves only the first. On its own it reported the case where the recommended
 * fix does nothing — an array whose contents genuinely move — and it reported it on every render,
 * which is how a diagnostic gets ignored.
 */
describe("RMD022 counts runs before it speaks", () => {
  test("a value that genuinely moves is never reported, however often the callback runs", async () => {
    class Panel extends Component {
      @state id = 1;
      probe = this.use(Probe, (self: Panel) => ({ key: ["user", self.id] }));
      render() {
        return <div>{this.probe.seen}</div>;
      }
    }

    const { instance, settle } = await getDOM<Panel>(<Panel />);
    for (let i = 2; i <= 6; i++) {
      instance.id = i;
      await settle();
    }

    /**
     * Six runs, a fresh array every one of them — the same-tick check calls this "built in place"
     * each time, and it is right. But `["user", 1]` and `["user", 2]` are not the same value, so
     * `@StableProps("key")` would hand back nothing and change nothing.
     *
     * This is the report the threshold removes. It used to fire on every render.
     */
    expect(reported()).not.toContain("RMD022");
    // And the hook really did see every one of them — silence here is not the check being blind.
    expect(instance.probe.keys.length).toBe(6);
  });

  test("below the threshold it stays quiet, and speaks once past it", async () => {
    class Panel extends Component {
      @state tick = 0;
      probe = this.use(Probe, (self: Panel) => ({ key: ["user", 1], count: self.tick }));
      render() {
        return <div>{this.probe.seen}</div>;
      }
    }

    const { instance, settle } = await getDOM<Panel>(<Panel />);

    instance.tick = 1;
    await settle();
    instance.tick = 2;
    await settle();

    // Three runs. One rebuild that happens to produce an equal value is ordinary; two is not yet
    // a pattern.
    expect(reported()).not.toContain("RMD022");

    instance.tick = 3;
    await settle();

    expect(reported()).toContain("RMD022");
    expect(reported()).toContain("`key`");
    expect(reported()).toContain("consecutive runs");
  });

  test("two use() sites of the same hook are counted separately", async () => {
    class Panel extends Component {
      @state tick = 0;
      // Same hook, same prop name, opposite behaviour.
      churning = this.use(Probe, (self: Panel) => ({ key: ["fixed"], count: self.tick }));
      moving = this.use(Probe, (self: Panel) => ({ key: ["row", self.tick], count: self.tick }));

      render() {
        return <div>{`${this.churning.seen}:${this.moving.seen}`}</div>;
      }
    }

    await churn(await getDOM<Panel>(<Panel />));

    /**
     * The counter is keyed by the call site's cache object rather than by owner and hook name,
     * and this is the assertion that says why. Those two sites share an owner, a hook class and a
     * prop name, so a counter keyed by those would merge them — and `moving` resets on every run,
     * which would cancel `churning`'s climb and silence a real report forever.
     */
    expect(reported()).toContain("RMD022");
    expect(reported()).toContain("`key`");
  });
});

describe("static StableProps — the hook declares it, the call site does not", () => {
  /**
   * The DX question this answers: a query key is a value, and the hook AUTHOR knows that.
   * Making every call site say so would put the hook's own semantics in the app's code. So a
   * hook declares which props are values, the app writes the natural literal, and the framework
   * holds the identity. For a hook that declared nothing, the call site holds the value itself —
   * a `@compute`, a field, a module constant.
   */
  @StableProps("key")
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

    // Three renders, one array — with nothing at all written at the call site.
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
      @state tick = 0;
      probe = this.use(Declared, (self: Panel) => ({ key: ["posts"], filter: { tag: "a" }, count: self.tick }));
      render() {
        return <div>{this.probe.seen}</div>;
      }
    }

    await churn(await getDOM<Panel>(<Panel />));

    // The declaration is per prop, not a blanket exemption.
    expect(reported()).toContain("RMD022");
    expect(reported()).toContain("`filter`");
    expect(reported()).not.toContain("`key`");
  });

  test("a function cannot be declared away — it is still reported", async () => {
    // A hook author cannot make a closure comparable by saying so: two closures with the
    // same body are not equal by any comparison that is safe to make.
    @StableProps("key", "fetch")
    class Fn extends Hook<Bag> {
      get seen(): string {
        return String(this.props.fetch?.());
      }
    }

    class Panel extends Component {
      @state tick = 0;
      probe = this.use(Fn, (self: Panel) => ({ fetch: () => self.constructor.name, count: self.tick }));
      render() {
        return <div>{this.probe.seen}</div>;
      }
    }

    await churn(await getDOM<Panel>(<Panel />));
    expect(reported()).toContain("new function for the `fetch` prop");
  });
});

describe("@StableProps is type-checked at the decoration site", () => {
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
    @StableProps("key")
    class Fine extends Hook<Shape> {}

    // An OPTIONAL prop is still a prop — checked through `keyof`, not by assignability.
    @StableProps("key", "filter")
    class Both extends Hook<Shape> {}

    // @ts-expect-error — "kye" is not a prop of Shape, and the error names it.
    @StableProps("kye")
    class Typo extends Hook<Shape> {}

    expect([Fine, Both, Typo].length).toBe(3);
  });

  test("a component is rejected twice over: by the compiler, and at decoration time", () => {
    expect(() => {
      // @ts-expect-error — a component instance is not structurally a hook (no
      // HOOK_RUNTIME), which is what makes this a compile error and not just a runtime one.
      @StableProps("key")
      class NotAHook extends Component<Shape> {
        render() {
          return <div />;
        }
      }
      return NotAHook;
      // The throw is the backstop for a build with no types, and it points at the
      // mechanism a component actually has.
    }).toThrow(/@StableProps is for hooks, not components/);
  });

  test("a hook with no props rejects any name", () => {
    // @ts-expect-error — nothing to declare on a hook that takes no props.
    @StableProps("key")
    class NoProps extends Hook {}

    expect(NoProps).toBeTypeOf("function");
  });
});

describe("@StableProps is a property of the KIND, not of an instance", () => {
  @StableProps("key")
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
    // needs no `[...Base.StableProps]` ceremony.
    expect(instance.probe.keys.length).toBe(1);
    expect(reported()).not.toContain("RMD022");
  });

  test("a subclass declaring more keeps what the parent declared", async () => {
    // A subclass declaring MORE. The decorator merges with what the parent declared
    // rather than replacing it, so `key` cannot be dropped by forgetting to spread it —
    // which is exactly what a `static` field would have done.
    @StableProps("filter")
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
      @state tick = 0;
      declared = this.use(Base, (self: Panel) => ({ key: ["a"], count: self.tick }));
      plain = this.use(Undeclared, (self: Panel) => ({ key: ["a"], count: self.tick }));
      render() {
        return <div>{`${this.declared.seen}:${this.plain.seen}`}</div>;
      }
    }

    await churn(await getDOM<Panel>(<Panel />));

    // Read from the same bag shape, in the same component: only the hook that declared
    // `key` is exempt. A static is per class, not a global switch.
    expect(reported()).toContain("Panel → Undeclared");
    expect(reported()).not.toContain("Panel → Base");
  });
});
