import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { getDOM, findOne } from "../test/setup";
import { state, updated, ShouldUpdateOnPropsChange } from "../base/decorators";
import { Component } from "../base/Component";
import { Hook } from "../base/Hook";
import { resetDiagnostics } from "../debug/diagnostics";

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

describe("update rules", () => {
  let captured: ReturnType<typeof captureDiagnostics>;

  beforeEach(() => {
    resetDiagnostics();
    vi.spyOn(console, "log").mockImplementation(() => {});
    captured = captureDiagnostics();
  });

  afterEach(() => {
    captured.stop();
    vi.restoreAllMocks();
  });

  describe("RMD008: state written after unmount", () => {
    let renders = 0;

    class Child extends Component {
      @state count = 0;
      render() {
        renders++;
        return (
          <div>
            <span>{this.count}</span>
          </div>
        );
      }
    }

    class Parent extends Component {
      @state show = true;
      render() {
        return (
          <div>
            <div>{this.show ? <Child /> : null}</div>
          </div>
        );
      }
    }

    beforeEach(() => {
      renders = 0;
    });

    test("the dead component does not re-render, and it is reported", async () => {
      const app = await getDOM<Parent>(<Parent />);
      await app.settle();

      const child = findOne<Child>(app.container, "Child");
      const childNode = app.container.querySelector("span")!;

      app.instance.show = false;
      await app.settle();
      expect(childNode.isConnected).toBe(false);

      const rendersWhileAlive = renders;

      // The case this exists for: an await resolves after the user navigated
      // away and writes state on the way back.
      child.count = 99;
      await app.settle();

      expect(renders).toBe(rendersWhileAlive);
      expect(captured.codes).toEqual(["RMD008"]);
      expect(captured.messages[0]).toContain("<Child /> changed state after it");
    });

    test("a live component still updates normally", async () => {
      // The guard keys off teardown, so it must not touch a component that is
      // merely idle — the check would be trivially "safe" if it stopped both.
      const app = await getDOM<Parent>(<Parent />);
      await app.settle();

      const child = findOne<Child>(app.container, "Child");

      const before = renders;
      child.count = 7;
      await app.settle();

      expect(renders).toBe(before + 1);
      expect(app.container.querySelector("span")!.textContent).toBe("7");
      expect(captured.codes).toEqual([]);
    });

    test("a write from @destroyed is not reported", async () => {
      // @destroyed runs before the component is marked dead, so tearing down own
      // state there is legitimate and must stay silent.
      class SelfCleaning extends Component {
        @state value = 1;
        render() {
          return (
            <div>
              <span>{this.value}</span>
            </div>
          );
        }
      }

      const app = await getDOM<SelfCleaning>(<SelfCleaning />);
      await app.settle();
      app.unmount();

      expect(captured.codes).toEqual([]);
    });
  });

  describe("RMD009: update loop", () => {
    test("two post-render writes feeding each other are stopped and reported", async () => {
      let runsA = 0;
      let runsB = 0;

      class PingPong extends Component {
        @state x = 0;
        @state y = 0;

        @updated
        a() {
          runsA++;
          // Safety net, not the thing under test: without the guard this loop
          // is unbounded and would hang the whole suite instead of failing.
          if (runsA > 500) return;
          this.y = this.x + 1;
        }

        @updated
        b() {
          runsB++;
          if (runsB > 500) return;
          this.x = this.y + 1;
        }

        render() {
          return (
            <div>
              <span>{this.x}</span>
            </div>
          );
        }
      }

      const app = await getDOM<PingPong>(<PingPong />);
      // `@updated` does not fire on mount, so the cascade needs a first render to follow.
      app.instance.x = 1;
      await app.settle();

      expect(captured.codes).toContain("RMD009");
      expect(captured.messages.join("\n")).toContain("<PingPong /> rebuilt 50 times");

      // The guard stopped it, not the safety net above.
      expect(runsA).toBeLessThan(100);
      expect(runsB).toBeLessThan(100);
    });

    test("a write in render() is stopped too", async () => {
      // RMD001 already names this, but naming it is no help if the tab freezes
      // before the developer can read the message.
      let renders = 0;

      class Runaway extends Component {
        @state count = 0;
        render() {
          renders++;
          if (renders > 500)
            return (
              <div>
                <span>net</span>
              </div>
            );
          this.count = this.count + 1;
          return (
            <div>
              <span>{this.count}</span>
            </div>
          );
        }
      }

      const app = await getDOM<Runaway>(<Runaway />);
      await app.settle();

      expect(captured.codes).toContain("RMD009");
      expect(renders).toBeLessThan(100);
    });

    test("many updates over time never trip the guard", async () => {
      // The counter is per drain, and this is why. Counting rebuilds for the
      // lifetime of the component instead would just be counting normal work:
      // the 51st click on a counter would be reported as an infinite loop.
      class Counter extends Component {
        @state count = 0;
        render() {
          return (
            <div>
              <span>{this.count}</span>
            </div>
          );
        }
      }

      const app = await getDOM<Counter>(<Counter />);
      await app.settle();

      for (let i = 1; i <= 60; i++) {
        app.instance.count = i;
        await app.settle();
      }

      expect(captured.codes).toEqual([]);
      expect(app.container.querySelector("span")!.textContent).toBe("60");
    });

    test("a post-render write that converges is not a loop", async () => {
      // A write that CONVERGES is not a loop, and this is the line between the two:
      // assigning the same value is not a change, so it schedules nothing and the
      // guard never has anything to count.
      let runs = 0;

      class Converging extends Component {
        @state count = 0;
        @state kick = 0;

        @updated
        settle() {
          runs++;
          if (runs > 500) return;
          this.count = 1; // the same value from the second run on
        }

        render() {
          return (
            <div>
              <span>{`${this.count}:${this.kick}`}</span>
            </div>
          );
        }
      }

      const app = await getDOM<Converging>(<Converging />);
      app.instance.kick = 1;
      await app.settle();

      // Two: the write on the first update changed the value, the render that
      // followed ran it again, and that write changed nothing.
      expect(runs).toBe(2);
      expect(captured.codes).toEqual([]);
      expect(app.container.querySelector("span")!.textContent).toBe("1:1");
    });
  });
});

describe("@ShouldUpdateOnPropsChange", () => {
  test("drops the incoming props when it returns false", async () => {
    const renders: string[] = [];

    @ShouldUpdateOnPropsChange((_self, previous, next) => previous.id !== next.id)
    class Row extends Component<{ id: string; noise: number }> {
      render() {
        renders.push(`${this.props.id}/${this.props.noise}`);
        return (
          <div>
            <p>{this.props.id}</p>
          </div>
        );
      }
    }

    class Board extends Component {
      @state id = "a";
      @state noise = 0;
      render() {
        return (
          <div>
            <Row id={this.id} noise={this.noise} />
          </div>
        );
      }
    }

    const { instance, settle } = await getDOM<Board>(<Board />);
    expect(renders).toEqual(["a/0"]);

    instance.noise = 1;
    await settle();
    // The predicate said no, so the whole update was dropped — no render, and the
    // new `noise` was not even applied (the next accepted update carries it).
    expect(renders).toEqual(["a/0"]);

    instance.id = "b";
    await settle();
    expect(renders.at(-1)).toBe("b/1");
  });

  test("a plain method by that name has no framework meaning", async () => {
    const renders: string[] = [];

    class Row extends Component<{ n: number }> {
      // Before this was a decorator, defining this would have silently taken
      // control of the component's re-rendering.
      shouldUpdateOnPropsChange() {
        return false;
      }
      render() {
        renders.push(String(this.props.n));
        return (
          <div>
            <p>{this.props.n}</p>
          </div>
        );
      }
    }

    class Board extends Component {
      @state n = 0;
      render() {
        return (
          <div>
            <Row n={this.n} />
          </div>
        );
      }
    }

    const { instance, settle } = await getDOM<Board>(<Board />);
    instance.n = 1;
    await settle();

    // It rendered: the method is just a method.
    expect(renders).toEqual(["0", "1"]);
  });

  test("throws at class-definition time when placed on a hook", () => {
    // Sooner than it used to: as a method decorator the throw waited for the first
    // instance, so a hook nobody had rendered yet looked fine. A class decorator runs
    // when the class is defined, which is the moment the mistake was made.
    expect(() => {
      // @ts-expect-error TypeScript refuses it first: the decorator asks for a class
      // branded `__isComponent`, which a Hook is not. The throw is what an untyped
      // build gets, and is what this test is about.
      @ShouldUpdateOnPropsChange(() => true)
      class BadHook extends Hook {
        nope() {
          return true;
        }
      }
      return BadHook;
    }).toThrow(/@ShouldUpdateOnPropsChange is for components, not hooks/);
  });
});

describe("a prop change re-renders the whole component", () => {
  test("even a prop render() never reads triggers a re-render (coarse, like state)", async () => {
    let childRenders = 0;

    class Child extends Component<{ a: number; b: number }> {
      render() {
        childRenders++;
        // Reads ONLY `a`, never `b`.
        return (
          <div>
            <span>{this.props.a}</span>
          </div>
        );
      }
    }

    class Parent extends Component {
      @state a = 1;
      @state b = 1;
      render() {
        return (
          <div>
            <Child a={this.a} b={this.b} />
          </div>
        );
      }
    }

    const { instance, settle } = await getDOM<Parent>(<Parent />);
    expect(childRenders).toBe(1);

    // Change ONLY the prop the child never reads — it still re-renders, because the
    // prop set differs. Documented in concepts/props.md.
    instance.b = 2;
    await settle();
    expect(childRenders).toBe(2);
  });

  test("passing the same prop values again re-renders nothing", async () => {
    let childRenders = 0;

    class Child extends Component<{ a: number }> {
      render() {
        childRenders++;
        return (
          <div>
            <span>{this.props.a}</span>
          </div>
        );
      }
    }

    class Parent extends Component {
      @state tick = 0;
      render() {
        // `a` never changes; bumping `tick` re-renders Parent and re-passes a={1}.
        void this.tick;
        return (
          <div>
            <Child a={1} />
          </div>
        );
      }
    }

    const { instance, settle } = await getDOM<Parent>(<Parent />);
    expect(childRenders).toBe(1);

    instance.tick = 1;
    await settle();
    // The shallow compare found nothing different, so the child was left alone.
    expect(childRenders).toBe(1);
  });
});
