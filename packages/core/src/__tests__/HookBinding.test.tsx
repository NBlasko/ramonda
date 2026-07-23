import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { getDOM } from "../test/setup";
import { Component, Host, Hook, state, compute } from "../index";

/**
 * A hook binds its methods so `this` survives being handed around as a callback,
 * without the hook ever needing a constructor. Every uncovered branch was in
 * that walk — what it skips, and why.
 *
 * Nothing was found broken here.
 */
describe("Hook", () => {
  beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  test("a method still works once detached from the hook", async () => {
    class Counter extends Hook {
      @state n = 0;
      inc() {
        this.n++;
      }
    }

    @Host("div")
    class C extends Component {
      c = this.use(Counter);
      render() {
        return <span onClick={this.c.inc}>{this.c.n}</span>;
      }
    }

    const app = await getDOM<C>(<C />);
    await app.settle();

    const detached = app.instance.c.inc;
    detached();
    await app.settle();

    expect(app.container.textContent).toBe("1");
  });

  test("a subclass gets the inherited methods bound too", async () => {
    class Base extends Hook {
      @state n = 0;
      inc() {
        this.n++;
      }
    }
    class Derived extends Base {
      dec() {
        this.n--;
      }
    }

    @Host("div")
    class C extends Component {
      c = this.use(Derived);
      render() {
        return <span>{this.c.n}</span>;
      }
    }

    const app = await getDOM<C>(<C />);
    await app.settle();

    const inherited = app.instance.c.inc; // declared on Base
    const own = app.instance.c.dec;
    inherited();
    inherited();
    own();
    await app.settle();

    // The walk goes up the whole prototype CHAIN. Binding only the own
    // prototype left an inherited handler unbound, and it failed silently —
    // the bug fixed in Component on 2026-07-17.
    expect(app.container.textContent).toBe("1");
  });

  test("an override in a subclass wins over the parent", async () => {
    class Base extends Hook {
      @state log = "";
      speak() {
        this.log += "base";
      }
    }
    class Derived extends Base {
      override speak() {
        this.log += "derived";
      }
    }

    @Host("div")
    class C extends Component {
      c = this.use(Derived);
      render() {
        return <span>{this.c.log}</span>;
      }
    }

    const app = await getDOM<C>(<C />);
    await app.settle();
    app.instance.c.speak();
    await app.settle();

    expect(app.container.textContent).toBe("derived");
  });

  test("a @compute getter is not evaluated while binding", async () => {
    let evaluated = 0;

    class WithCompute extends Hook {
      @state n = 2;
      @compute get doubled() {
        evaluated++;
        return this.n * 2;
      }
    }

    @Host("div")
    class C extends Component {
      @state show = false;
      c = this.use(WithCompute);
      render() {
        return <span>{this.show ? this.c.doubled : "-"}</span>;
      }
    }

    const app = await getDOM<C>(<C />);
    await app.settle();

    // The descriptor is inspected instead of the value: reading the value would
    // INVOKE the getter, computing before the hook is ready to be read.
    expect(evaluated).toBe(0);

    app.instance.show = true;
    await app.settle();
    expect(evaluated).toBe(1);
    expect(app.container.textContent).toBe("4");
  });

  test("an _underscore method is deliberately left unbound", async () => {
    class H extends Hook {
      @state n = 0;
      _private() {
        return this === undefined;
      }
    }

    @Host("div")
    class C extends Component {
      c = this.use(H);
      render() {
        return <span>x</span>;
      }
    }

    const app = await getDOM<C>(<C />);
    await app.settle();

    // Internal by convention, so binding is not paid for it. Detached, its
    // `this` is gone — which is the point: it was never meant to travel.
    //
    // The cost this buys back, measured per instance (construction alone vs
    // construction + binding every method): 4 methods 0.018 -> 0.195 µs,
    // 8 methods 0.026 -> 0.480 µs, 16 methods 0.023 -> 2.066 µs. Binding
    // dominates construction and scales with method count, which is why the
    // opt-out exists at all.
    const loose = app.instance.c._private;
    expect(loose()).toBe(true);
  });

  test("a hook used without options can still read this.options", async () => {
    class H extends Hook {
      @state n = 0;
      peek() {
        return (this as unknown as { options: Record<string, unknown> }).options?.anything;
      }
    }

    @Host("div")
    class C extends Component {
      c = this.use(H);
      render() {
        return <span>x</span>;
      }
    }

    const app = await getDOM<C>(<C />);
    await app.settle();

    // `this.use(H)` with no options at all, then reading one: undefined, not a
    // TypeError out of an empty options bag.
    expect(app.instance.c.peek()).toBeUndefined();
  });
});
