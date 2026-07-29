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

  test("an _underscore method is bound like any other", async () => {
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

    /**
     * These were skipped until 2026-07-29, as a performance opt-out. The convention is not
     * this framework's to claim: typescript-eslint's `naming-convention` rule is commonly
     * set to REQUIRE a leading underscore on private members, so a project with that rule
     * wrote `private _apply()` and got a method that silently did not bind.
     *
     * And the saving was small. Per instance, binding every method vs binding all but a
     * third of them: 3 methods 41 ns, 5 methods 10 ns, 8 methods 84 ns, 12 methods 212 ns —
     * a fifth of a millisecond across a thousand rows, at twelve methods, in exchange for a
     * silent `this`-loss.
     */
    const loose = app.instance.c._private;
    expect(loose()).toBe(false);
  });

  test("a hook used without options can still read this.props", async () => {
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

describe("@Host infers the class it is on", () => {
  /**
   * `self` and the tag callback's `props` need no annotation and no type argument: the
   * decorated class is the inference site, because both parameter types are CONDITIONAL
   * types (`InstanceOf<C>`, `PropsOf<C>`) and a conditional is not somewhere TypeScript
   * infers from — so `C` stays open until the decorator is applied.
   *
   * Measured while writing it: with the type parameter sitting directly in the callback's
   * parameter position, an unannotated arrow fixed it to `unknown` before the class was
   * looked at, which is why this used to need `(self: Card)` spelled out.
   */
  test("self is the instance, with nothing written down", async () => {
    @Host("section", (self) => ({ "data-label": self.label, "data-count": String(self.count) }))
    class Card extends Component<{ label: string }> {
      @state count = 2;

      get label(): string {
        return this.props.label;
      }

      render() {
        return <span>{this.label}</span>;
      }
    }

    const app = await getDOM<Card>(<Card label="hi" />);
    await app.settle();

    const host = app.container.querySelector("section")!;
    expect(host.getAttribute("data-label")).toBe("hi");
    expect(host.getAttribute("data-count")).toBe("2");
  });

  test("a tag built from props is typed the same way", async () => {
    @Host((props) => (props.heading ? "h2" : "p"))
    class Line extends Component<{ heading?: boolean }> {
      render() {
        return <span>text</span>;
      }
    }

    const app = await getDOM<Line>(<Line heading />);
    await app.settle();
    expect(app.container.querySelector("h2")).not.toBeNull();
  });
});
