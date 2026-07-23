import { describe, test, expect, beforeEach, vi } from "vitest";
import { getDOM } from "../test/setup";
import { Component } from "../base/Component";
import { state, interval, timeout } from "../base/decorators";

let log: string[] = [];

beforeEach(() => {
  log = [];
});

describe("@interval", () => {
  test("runs every ms, receives self, stops on unmount", async () => {
    vi.useFakeTimers();
    try {
      class Ticker extends Component {
        @state count = 0;
        @interval(1000)
        tick() {
          this.count++;
          log.push(`tick:${this.count}`);
        }
        render() {
          return <div>{this.count}</div>;
        }
      }

      const app = await getDOM<Ticker>(<Ticker />);

      vi.advanceTimersByTime(3000);
      expect(log).toEqual(["tick:1", "tick:2", "tick:3"]);

      // Cleanup: unmount clears the interval.
      app.unmount();
      vi.advanceTimersByTime(5000);
      expect(log).toEqual(["tick:1", "tick:2", "tick:3"]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("@timeout", () => {
  test("runs once after ms", async () => {
    vi.useFakeTimers();
    try {
      class Delayed extends Component {
        @timeout(500)
        later() {
          log.push("fired");
        }
        render() {
          return <div>x</div>;
        }
      }

      await getDOM<Delayed>(<Delayed />);

      vi.advanceTimersByTime(499);
      expect(log).toEqual([]);

      vi.advanceTimersByTime(1);
      expect(log).toEqual(["fired"]);

      // Does not fire again.
      vi.advanceTimersByTime(5000);
      expect(log).toEqual(["fired"]);
    } finally {
      vi.useRealTimers();
    }
  });

  test("is cancelled if the component unmounts before it fires", async () => {
    vi.useFakeTimers();
    try {
      class Delayed extends Component {
        @timeout(500)
        later() {
          log.push("fired");
        }
        render() {
          return <div>x</div>;
        }
      }

      const app = await getDOM<Delayed>(<Delayed />);

      // Unmount before the timeout elapses → cleanup clears it.
      app.unmount();
      vi.advanceTimersByTime(1000);
      expect(log).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  test("runs with `this` bound to the component and can mutate its state", async () => {
    vi.useFakeTimers();
    try {
      class Delayed extends Component {
        @state ready = false;
        @timeout(200)
        finish() {
          log.push(`this:${this instanceof Delayed}`);
          this.ready = true;
        }
        render() {
          return <div>{this.ready ? "ready" : "waiting"}</div>;
        }
      }

      const app = await getDOM<Delayed>(<Delayed />);
      expect(app.container.textContent).toContain("waiting");

      vi.advanceTimersByTime(200);
      await app.settle();

      expect(log).toEqual(["this:true"]);
      expect(app.container.textContent).toContain("ready");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("@interval + @timeout together", () => {
  test("two intervals at different rates fire independently", async () => {
    vi.useFakeTimers();
    try {
      class Multi extends Component {
        @interval(100)
        fast() {
          log.push("fast");
        }
        @interval(250)
        slow() {
          log.push("slow");
        }
        render() {
          return <div>x</div>;
        }
      }

      const app = await getDOM<Multi>(<Multi />);

      vi.advanceTimersByTime(500);
      // fast: 100,200,300,400,500 → 5 ; slow: 250,500 → 2
      expect(log.filter((l) => l === "fast")).toHaveLength(5);
      expect(log.filter((l) => l === "slow")).toHaveLength(2);

      app.unmount();
      vi.advanceTimersByTime(1000);
      expect(log.filter((l) => l === "fast")).toHaveLength(5);
      expect(log.filter((l) => l === "slow")).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
