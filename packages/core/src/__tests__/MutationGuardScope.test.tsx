import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { getDOM } from "../test/setup";
import { Component, Host, state, list } from "../index";
import { resetDiagnostics } from "../debug/diagnostics";

/**
 * What the in-place mutation guard covers, and what it costs to cover it.
 *
 * A signal fires when it is ASSIGNED a new value. Changing the value it already
 * holds — `this.items.push(x)`, `this.user.name = "x"` — writes into that value,
 * so nothing compares as different and nothing re-renders. The page goes on
 * showing what it showed before, silently.
 *
 * Arrays were reported (RMD005) and objects were not, which was the asymmetry a
 * reader could not see: the docs even said both were caught. Objects are reported
 * now too (RMD048), through a proxy that wraps LAZILY — a `get` returns a guarded
 * child only when something asks for that child, so the proxy tree follows the
 * path a render actually reads and nowhere else. Reading `user.name` costs two
 * proxies whatever the size of `user`.
 *
 * The identity tests are not decoration. They are the reason the first version of
 * this was wrong: a proxy escapes into user code the moment anything copies, and
 * wrapping an escaped proxy again produces an identity nothing has seen. Measured
 * before that was fixed: a no-op render moved 200 of 200 list nodes.
 */
describe("the in-place mutation guard", () => {
  const logged: string[] = [];

  beforeEach(() => {
    logged.length = 0;
    resetDiagnostics();
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    });
  });
  afterEach(() => vi.restoreAllMocks());

  const reported = (code: string) => logged.filter((line) => line.includes(code));

  test("an array mutated in place is reported (RMD005)", async () => {
    @Host("div")
    class App extends Component {
      @state items: string[] = ["a"];
      render() {
        return <p>{this.items.length}</p>;
      }
    }

    const app = await getDOM<App>(<App />);
    await app.settle();

    app.instance.items.push("b");
    expect(reported("RMD005").length).toBeGreaterThan(0);
  });

  test("an object mutated in place is reported (RMD048)", async () => {
    @Host("div")
    class App extends Component {
      @state user = { name: "ada" };
      render() {
        return <p>{this.user.name}</p>;
      }
    }

    const app = await getDOM<App>(<App />);
    await app.settle();

    app.instance.user.name = "grace";
    await app.settle();

    expect(reported("RMD048").length).toBeGreaterThan(0);
    // Still a no-op, which is what the report is about: the signal never fired.
    expect(app.container.querySelector("p")!.textContent).toBe("ada");
  });

  test("a NESTED change is reported, and named by its path", async () => {
    @Host("div")
    class App extends Component {
      @state user = { name: "ada", address: { city: "london" } };
      render() {
        return <p>{this.user.address.city}</p>;
      }
    }

    const app = await getDOM<App>(<App />);
    await app.settle();

    app.instance.user.address.city = "paris";

    // The path is what makes the message actionable — `user.address.city`, not
    // "an object in state".
    expect(reported("RMD048").some((line) => line.includes("address.city"))).toBe(true);
  });

  test("deleting a key is a change too", async () => {
    @Host("div")
    class App extends Component {
      @state config: Record<string, unknown> = { debug: true };
      render() {
        return <p>{String(this.config.debug)}</p>;
      }
    }

    const app = await getDOM<App>(<App />);
    await app.settle();

    delete app.instance.config.debug;
    expect(reported("RMD048").length).toBeGreaterThan(0);
  });

  test("replacing works, and rebuilding the path works — which is the advice", async () => {
    @Host("div")
    class App extends Component {
      @state user = { name: "ada", address: { city: "london" } };
      render() {
        return (
          <p>
            {this.user.name}:{this.user.address.city}
          </p>
        );
      }
    }

    const app = await getDOM<App>(<App />);
    await app.settle();

    app.instance.user = { ...app.instance.user, name: "grace" };
    await app.settle();
    expect(app.container.querySelector("p")!.textContent).toBe("grace:london");

    app.instance.user = {
      ...app.instance.user,
      address: { ...app.instance.user.address, city: "paris" },
    };
    await app.settle();
    expect(app.container.querySelector("p")!.textContent).toBe("grace:paris");

    expect(reported("RMD048")).toEqual([]);
  });

  test("identity is stable, so nothing reads as changed for having been guarded", async () => {
    @Host("div")
    class App extends Component {
      @state user = { address: { city: "london" } };
      render() {
        return <p>{this.user.address.city}</p>;
      }
    }

    const app = await getDOM<App>(<App />);
    await app.settle();

    // Two reads of the same value are the same object, at every level.
    expect(app.instance.user).toBe(app.instance.user);
    expect(app.instance.user.address).toBe(app.instance.user.address);
  });

  test("a copy put back into state does not churn identity", async () => {
    /**
     * The regression this guard's first version had. `[...this.rows]` spreads
     * GUARDED children into a new array, and the setter unwraps only the array it
     * is handed — so the state ends up holding proxies. Reading them back must not
     * wrap them a second time, or every row has an identity nothing has seen and
     * the reconciler moves every node.
     */
    interface Row {
      id: number;
    }

    let renders = 0;

    @Host("ul")
    class App extends Component {
      @state rows: Row[] = [{ id: 1 }, { id: 2 }, { id: 3 }];
      @state tick = 0;
      render() {
        renders++;
        return list(this.rows, (r: Row) => <li>{r.id}</li>);
      }
    }

    const app = await getDOM<App>(<App />);
    await app.settle();
    const before = [...app.container.querySelectorAll("li")];

    // A copy, exactly as an app would write it, put straight back.
    app.instance.rows = [...app.instance.rows];
    await app.settle();

    const after = [...app.container.querySelectorAll("li")];
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
    expect(after[2]).toBe(before[2]);
    expect(renders).toBeGreaterThan(1);
  });

  test("a FROZEN object can still be read", async () => {
    /**
     * A proxy is not allowed to hand back something other than the real value for
     * a property that is non-writable AND non-configurable — the engine throws a
     * TypeError rather than letting a proxy lie about a value that can never
     * change. `Object.freeze` makes every own property exactly that.
     *
     * So the guard crashed the very code that had already protected itself: freeze
     * the object, read a nested value out of it, and the read threw — in
     * development only, which is the worst place for it, because production was
     * fine and the app was broken only while it was being worked on.
     *
     * Nothing is lost by handing the raw value back: a frozen property cannot be
     * assigned, so there is no in-place change under it to report.
     */
    @Host("div")
    class App extends Component {
      @state config = Object.freeze({ nested: { label: "hi" } });
      @state rows = Object.freeze([{ id: 1 }]);
      render() {
        return (
          <p>
            {this.config.nested.label}:{this.rows[0].id}
          </p>
        );
      }
    }

    const app = await getDOM<App>(<App />);
    await app.settle();

    expect(app.container.querySelector("p")!.textContent).toBe("hi:1");
  });

  test("a Date, a Map and a class instance are left alone", async () => {
    /**
     * Their methods need the real receiver — `proxy.getTime()` reaches for an
     * internal slot a proxy does not have — so wrapping them would break working
     * code for the sake of a report nobody asked for.
     */
    class Money {
      constructor(public amount: number) {}
      double() {
        return this.amount * 2;
      }
    }

    @Host("div")
    class App extends Component {
      @state when = new Date(0);
      @state seen = new Map<string, number>([["a", 1]]);
      @state price = new Money(5);
      render() {
        return <p>x</p>;
      }
    }

    const app = await getDOM<App>(<App />);
    await app.settle();

    expect(app.instance.when.getTime()).toBe(0);
    expect(app.instance.seen.get("a")).toBe(1);
    expect(app.instance.price.double()).toBe(10);
  });
});
