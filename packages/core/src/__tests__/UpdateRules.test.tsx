import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { getDOM } from "../test/setup";
import { state, Host, effect, shouldUpdateProps } from "../base/decorators";
import { Component } from "../base/Component";
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

    @Host("div")
    class Child extends Component {
      @state count = 0;
      render() {
        renders++;
        return <span>{this.count}</span>;
      }
    }

    @Host("div")
    class Parent extends Component {
      @state show = true;
      render() {
        return <div>{this.show ? <Child /> : null}</div>;
      }
    }

    beforeEach(() => {
      renders = 0;
    });

    test("the dead component does not re-render, and it is reported", async () => {
      const app = await getDOM<Parent>(<Parent />);
      await app.settle();

      const childEl = app.container.querySelector("[data-ramonda='Child']") as
        | (Element & { _componentInstance?: Child })
        | null;
      const child = childEl!._componentInstance!;

      app.instance.show = false;
      await app.settle();
      expect(childEl!.isConnected).toBe(false);

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

      const child = (
        app.container.querySelector("[data-ramonda='Child']") as Element & {
          _componentInstance?: Child;
        }
      )._componentInstance!;

      const before = renders;
      child.count = 7;
      await app.settle();

      expect(renders).toBe(before + 1);
      expect(app.container.querySelector("span")!.textContent).toBe("7");
      expect(captured.codes).toEqual([]);
    });

    test("a write from @destroy is not reported", async () => {
      // @destroy runs before the component is marked dead, so tearing down own
      // state there is legitimate and must stay silent.
      @Host("div")
      class SelfCleaning extends Component {
        @state value = 1;
        render() {
          return <span>{this.value}</span>;
        }
      }

      const app = await getDOM<SelfCleaning>(<SelfCleaning />);
      await app.settle();
      app.unmount();

      expect(captured.codes).toEqual([]);
    });
  });

  describe("RMD009: update loop", () => {
    test("two effects writing each other's state are stopped and reported", async () => {
      let runsA = 0;
      let runsB = 0;

      @Host("div")
      class PingPong extends Component {
        @state x = 0;
        @state y = 0;

        @effect
        a() {
          runsA++;
          // Safety net, not the thing under test: without the guard this loop
          // is unbounded and would hang the whole suite instead of failing.
          if (runsA > 500) return;
          this.y = this.x + 1;
        }

        @effect
        b() {
          runsB++;
          if (runsB > 500) return;
          this.x = this.y + 1;
        }

        render() {
          return <span>{this.x}</span>;
        }
      }

      const app = await getDOM<PingPong>(<PingPong />);
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

      @Host("div")
      class Runaway extends Component {
        @state count = 0;
        render() {
          renders++;
          if (renders > 500) return <span>net</span>;
          this.count = this.count + 1;
          return <span>{this.count}</span>;
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
      @Host("div")
      class Counter extends Component {
        @state count = 0;
        render() {
          return <span>{this.count}</span>;
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

    test("an effect that writes the signal it reads is already unsubscribed", async () => {
      // Not the loop guard — `runComponentEffects` detaches deps an effect
      // mutated itself, so a self-writing effect runs once and stops. Worth
      // pinning: it is why the loop above needs *two* effects to reproduce.
      let runs = 0;

      @Host("div")
      class SelfWrite extends Component {
        @state count = 0;

        @effect
        climb() {
          runs++;
          if (runs > 500) return;
          this.count = this.count + 1;
        }

        render() {
          return <span>{this.count}</span>;
        }
      }

      const app = await getDOM<SelfWrite>(<SelfWrite />);
      await app.settle();

      expect(runs).toBe(1);
      expect(captured.codes).toEqual([]);
      expect(app.container.querySelector("span")!.textContent).toBe("1");
    });
  });
});

describe("@shouldUpdateProps", () => {
  test("skips the render when it returns false, and the method name is yours", async () => {
    const renders: string[] = [];

    @Host("div")
    class Row extends Component<{ id: string; noise: number }> {
      // Named for what it means here, not for what the framework calls it.
      @shouldUpdateProps
      onlyWhenIdChanges(previous: { id: string; noise: number }, next: { id: string; noise: number }) {
        return previous.id !== next.id;
      }

      render() {
        renders.push(`${this.props.id}/${this.props.noise}`);
        return <p>{this.props.id}</p>;
      }
    }

    @Host("div")
    class Board extends Component {
      @state id = "a";
      @state noise = 0;
      render() {
        return <Row id={this.id} noise={this.noise} />;
      }
    }

    const { instance, settle } = await getDOM<Board>(<Board />);
    expect(renders).toEqual(["a/0"]);

    instance.noise = 1;
    await settle();
    // The prop changed and the render was skipped, because the method said so.
    expect(renders).toEqual(["a/0"]);

    instance.id = "b";
    await settle();
    expect(renders.at(-1)).toBe("b/1");
  });

  test("a plain method called shouldUpdateProps has no framework meaning", async () => {
    const renders: string[] = [];

    @Host("div")
    class Row extends Component<{ n: number }> {
      // Before this was a decorator, defining this would have silently taken
      // control of the component's re-rendering.
      shouldUpdateProps() {
        return false;
      }
      render() {
        renders.push(String(this.props.n));
        return <p>{this.props.n}</p>;
      }
    }

    @Host("div")
    class Board extends Component {
      @state n = 0;
      render() {
        return <Row n={this.n} />;
      }
    }

    const { instance, settle } = await getDOM<Board>(<Board />);
    instance.n = 1;
    await settle();

    // It rendered: the method is just a method.
    expect(renders).toEqual(["0", "1"]);
  });
});
