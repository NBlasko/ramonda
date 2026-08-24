import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { getDOM, findOne } from "../test/setup";
import { Component, state, destroyed, interval, createContext } from "../index";
import { effectLike } from "../test/effectLike";

const [Provider, Ctx] = createContext({ v: "a" });

/**
 * Teardown is a sequence of things the APP wrote — effect cleanups and
 * `@destroyed` bodies — and one throw used to abort all of it: the remaining
 * cleanups, the signal unsubscribes, the `isDestroyed` flag, and the caller's
 * `child.remove()`. A `@destroyed` that threw left the element on the page, still
 * rendered, with the component half alive.
 */
describe("unmount cleanup", () => {
  beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  test("a throwing @destroyed does not take the rest of teardown down", async () => {
    const ran: string[] = [];
    class Child extends Component {
      @state n = 0;
      @destroyed first() {
        ran.push("first");
        throw new Error("boom");
      }
      @destroyed second() {
        ran.push("second");
      }
      render() {
        return (
          <div>
            <span>{this.n}</span>
          </div>
        );
      }
    }
    class App extends Component {
      @state show = true;
      render() {
        return (
          <div>
            <div>{this.show ? <Child /> : null}</div>
          </div>
        );
      }
    }
    const app = await getDOM<App>(<App />);
    await app.settle();
    vi.spyOn(console, "error").mockImplementation(() => {});

    app.instance.show = false;
    await app.settle();

    // Destroys run in reverse, so the throwing one goes LAST — and everything
    // after it in the sweep used to be skipped.
    expect(ran).toEqual(["second", "first"]);
    // The measurable consequence: the element stayed on the page ("0").
    expect(app.container.textContent).toBe("");
  });

  test("a throwing effect cleanup does not skip @destroyed", async () => {
    const ran: string[] = [];
    class Child extends Component {
      @state n = 0;
      @interval(1000) tick() {
        this.n++;
      }
      @effectLike() bad() {
        ran.push("effect");
        return () => {
          throw new Error("cleanup boom");
        };
      }
      @destroyed after() {
        ran.push("destroy");
      }
      render() {
        return (
          <div>
            <span>{this.n}</span>
          </div>
        );
      }
    }
    class App extends Component {
      @state show = true;
      render() {
        return (
          <div>
            <div>{this.show ? <Child /> : null}</div>
          </div>
        );
      }
    }
    const app = await getDOM<App>(<App />);
    await app.settle();
    vi.spyOn(console, "error").mockImplementation(() => {});

    app.instance.show = false;
    await app.settle();

    // Effect cleanups run before @destroyed, so a throw there used to mean the
    // component's own teardown never happened at all.
    expect(ran).toContain("destroy");
    expect(app.container.textContent).toBe("");
  });

  test("a write after unmount schedules no render", async () => {
    let renders = 0;
    class Child extends Component {
      @state n = 0;
      render() {
        renders++;
        return (
          <div>
            <span>{this.n}</span>
          </div>
        );
      }
    }
    class App extends Component {
      @state show = true;
      render() {
        return (
          <div>
            <div>{this.show ? <Child /> : null}</div>
          </div>
        );
      }
    }
    const app = await getDOM<App>(<App />);
    await app.settle();
    const child = findOne<any>(app.container, "Child");
    app.instance.show = false;
    await app.settle();
    const before = renders;

    // The fetch that resolves after the user navigated away.
    child.n = 99;
    await app.settle();
    expect(renders).toBe(before);
  });

  test("an unmounted consumer stops listening to the provider", async () => {
    class Consumer extends Component {
      ctx = this.use(Ctx);
      render() {
        return (
          <div>
            <span>{this.ctx.v}</span>
          </div>
        );
      }
    }
    class App extends Component {
      @state v = "a";
      @state show = true;
      p = this.use(Provider, () => ({ v: this.v }));
      render() {
        return (
          <div>
            <div>{this.show ? <Consumer /> : null}</div>
          </div>
        );
      }
    }
    const app = await getDOM<App>(<App />);
    await app.settle();
    const sym = Object.getOwnPropertySymbols((app.instance as any).p).find((s) =>
      String(s).includes("hookRuntime"),
    ) as symbol;
    const sig: any = (app.instance as any).p[sym].propsSignals.get("v");
    const count = (x: any) => (x?._listeners ? x._listeners.size : x?._listener !== undefined ? 1 : 0);
    expect(count(sig)).toBe(2); // the consumer, plus the providing component

    app.instance.show = false;
    await app.settle();
    expect(count(sig)).toBe(1);
  });
});
