import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { getDOM } from "../test/setup";
import { Component, Host, state } from "../index";
import { resetDiagnostics } from "../debug/diagnostics";

/**
 * How far the in-place mutation guard reaches, pinned — because the docs used to
 * claim it reached further.
 *
 * RMD005 hands out a proxy for an ARRAY held in a signal, so `this.items.push(x)`
 * is reported instead of silently doing nothing. An object gets no proxy:
 * `this.user.name = "x"` is the same silent no-op with nothing said about it, and
 * `concepts/state.md` told readers that "changing an array or object in place is
 * caught and reported as RMD005".
 *
 * Both halves are asserted here on purpose. The first is the feature; the second
 * is its limit, and it is the one that matters — the day an object guard is added,
 * this test fails, and whoever adds it is sent to the sentence that has to change
 * with it. A limit nobody can see is how documentation drifts.
 */
describe("what the in-place mutation guard covers", () => {
  const logged: string[] = [];

  beforeEach(() => {
    logged.length = 0;
    resetDiagnostics();
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    });
  });
  afterEach(() => vi.restoreAllMocks());

  const reported = () => logged.filter((line) => line.includes("RMD005"));

  test("an array mutated in place is reported", async () => {
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

    expect(reported().length).toBeGreaterThan(0);
  });

  test("an object mutated in place is NOT — the guard is arrays only", async () => {
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

    // Silent, and the render still shows the old value — the signal never fired,
    // which is the whole point of the report the array case gets.
    expect(reported()).toEqual([]);
    expect(app.container.querySelector("p")!.textContent).toBe("ada");
  });

  test("replacing the object works, which is what the docs must tell people to do", async () => {
    @Host("div")
    class App extends Component {
      @state user = { name: "ada" };
      render() {
        return <p>{this.user.name}</p>;
      }
    }

    const app = await getDOM<App>(<App />);
    await app.settle();

    app.instance.user = { ...app.instance.user, name: "grace" };
    await app.settle();

    expect(app.container.querySelector("p")!.textContent).toBe("grace");
  });
});
