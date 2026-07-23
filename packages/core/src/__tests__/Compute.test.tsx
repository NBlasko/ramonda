import { describe, test, expect } from "vitest";
import { getDOM } from "../test/setup";
import { state, compute, Host } from "../base/decorators";
import { Component } from "../base/Component";

describe("@compute", () => {
  test("caches result — computation runs only once when deps unchanged", async () => {
    let computeCount = 0;

    class Comp extends Component {
      @state a = 1;
      @state b = 2;
      @state unrelated = 0;

      @compute
      get sum() {
        computeCount++;
        return this.a + this.b;
      }

      render() {
        return (
          <div>
            {this.sum}
            {this.sum}
            {this.sum}
          </div>
        );
      }
    }

    await getDOM(<Comp />);

    // sum se cita 3 puta u renderu ali treba da se izracuna samo jednom
    expect(computeCount).toBe(1);
  });

  test("recomputes when a dep State changes", async () => {
    let computeCount = 0;

    class Comp extends Component {
      @state a = 1;
      @state b = 2;

      @compute
      get sum() {
        computeCount++;
        return this.a + this.b;
      }

      render() {
        return <div>{this.sum}</div>;
      }
    }

    const { instance, settle, container } = await getDOM<Comp>(<Comp />);
    expect(computeCount).toBe(1);
    expect(container.querySelector("div")!.textContent).toBe("3");

    instance.a = 10;
    await settle();

    expect(computeCount).toBe(2);
    expect(container.querySelector("div")!.textContent).toBe("12");
  });

  test("does NOT recompute when unrelated state changes", async () => {
    let computeCount = 0;

    class Comp extends Component {
      @state a = 1;
      @state b = 2;
      @state counter = 0;

      @compute
      get sum() {
        computeCount++;
        return this.a + this.b;
      }

      render() {
        return (
          <div>
            {this.sum} {this.counter}
          </div>
        );
      }
    }

    const { instance, settle } = await getDOM<Comp>(<Comp />);
    expect(computeCount).toBe(1);

    // Menjamo counter koji nije dep sum-a
    instance.counter = 99;
    await settle();

    // Re-render se desio, ali sum nije recomputed
    expect(computeCount).toBe(1);
  });

  test("invalidates across multiple dep changes", async () => {
    let computeCount = 0;

    class Comp extends Component {
      @state values = [1, 2, 3];

      @compute
      get total() {
        computeCount++;
        return this.values.reduce((s, v) => s + v, 0);
      }

      render() {
        return <div>{this.total}</div>;
      }
    }

    const { instance, settle, container } = await getDOM<Comp>(<Comp />);
    expect(computeCount).toBe(1);
    expect(container.querySelector("div")!.textContent).toBe("6");

    instance.values = [10, 20, 30];
    await settle();

    expect(computeCount).toBe(2);
    expect(container.querySelector("div")!.textContent).toBe("60");

    instance.values = [1];
    await settle();

    expect(computeCount).toBe(3);
    expect(container.querySelector("div")!.textContent).toBe("1");
  });
  test("a compute reading another compute invalidates through it", async () => {
    // A cached @compute touches no State when read, so the enclosing tracker
    // used to record nothing and `quad` stayed stale forever: measured "10|4".
    // The getter now replays its own deps into whoever is reading it.
    @Host("div")
    class Chain extends Component {
      @state n = 1;
      @compute get double() {
        return this.n * 2;
      }
      @compute get quad() {
        return this.double * 2;
      }
      render() {
        return (
          <span>
            {this.double}|{this.quad}
          </span>
        );
      }
    }

    const { instance, settle, container } = await getDOM<Chain>(<Chain />);
    expect(container.textContent).toBe("2|4");

    instance.n = 5;
    await settle();
    expect(container.textContent).toBe("10|20");
  });
});
