import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Component } from "../base/Component";
import { destroyed, state } from "../base/decorators";
import { Hook } from "../base/Hook";
import { Timer } from "../base/Timer";
import { renderToString } from "../hydration/ssr";
import { getDOM } from "../test/setup";
import type { RamondaNode } from "../types/vdom";

/**
 * `Timer` — a timer the app arms, and the framework still owns.
 *
 * The decorators cover "run this on a clock while I am on the page". This covers "start now, stop
 * when I say", which no decorator can express: a decorator fires relative to MOUNT.
 *
 * **The half that matters most is teardown**, because that is the leak the hook exists to make
 * impossible. A raw `setTimeout` armed on a click keeps the component alive and then writes into
 * something that is gone — `RMD008` drops the write, so the symptom is a handler that quietly does
 * nothing. Every arming path here is asserted to be silent after unmount.
 */

let log: string[] = [];

beforeEach(() => {
  log = [];
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

class Card extends Component {
  @state gone = false;
  removal = this.use(Timer);

  leave(ms = 3000) {
    this.removal.after(ms, () => {
      this.gone = true;
      log.push("left");
    });
  }

  cancel() {
    this.removal.stop();
  }

  render(): RamondaNode {
    return <div>{this.gone ? "gone" : "here"}</div>;
  }
}

describe("after", () => {
  test("runs once, at the delay and not before", async () => {
    const app = await getDOM<Card>(<Card />);
    app.instance.leave(500);

    vi.advanceTimersByTime(499);
    expect(log).toEqual([]);

    vi.advanceTimersByTime(1);
    expect(log).toEqual(["left"]);

    vi.advanceTimersByTime(5000);
    expect(log).toEqual(["left"]);
    app.unmount();
  });

  test("the body writes state, and the component renders it", async () => {
    const app = await getDOM<Card>(<Card />);
    expect(app.container.textContent).toBe("here");

    app.instance.leave(100);
    vi.advanceTimersByTime(100);
    await app.settle();

    expect(app.container.textContent).toBe("gone");
    app.unmount();
  });

  test("`stop()` before the delay cancels it", async () => {
    const app = await getDOM<Card>(<Card />);
    app.instance.leave(500);
    app.instance.cancel();

    vi.advanceTimersByTime(5000);
    expect(log).toEqual([]);
    app.unmount();
  });

  test("`stop()` with nothing armed is not an error", async () => {
    const app = await getDOM<Card>(<Card />);
    expect(() => app.instance.cancel()).not.toThrow();
    app.unmount();
  });

  /**
   * Re-arming RESTARTS, which is the rule that lets `stop()` need no handle: one hook instance is one
   * timer. The first delay is asserted to be GONE rather than merely late — a second timer left
   * running is the failure this pins.
   */
  test("arming again restarts, and the first one never fires", async () => {
    const app = await getDOM<Card>(<Card />);
    app.instance.leave(500);
    vi.advanceTimersByTime(400);
    app.instance.leave(500);

    // 100ms short of the SECOND delay, and 500 past where the first one would have fired.
    vi.advanceTimersByTime(400);
    expect(log).toEqual([]);

    vi.advanceTimersByTime(100);
    expect(log).toEqual(["left"]);
    app.unmount();
  });

  /** The leak, and the reason the hook exists. */
  test("unmount before the delay clears it", async () => {
    const app = await getDOM<Card>(<Card />);
    app.instance.leave(1000);
    app.unmount();

    vi.advanceTimersByTime(5000);
    expect(log).toEqual([]);
  });

  /**
   * Arming AFTER teardown is the second half of the same leak, and it is not the same case:
   * `@destroyed` has already run, so nothing would ever clear this one. A late `await` landing in a
   * handler is exactly how it happens.
   */
  test("arming after the owner is gone does nothing", async () => {
    const app = await getDOM<Card>(<Card />);
    app.unmount();
    app.instance.leave(1000);

    vi.advanceTimersByTime(5000);
    expect(log).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  /**
   * A body that RE-ARMS and does not stop: the re-armed timer is the one teardown has to reach.
   *
   * Planted, because the first version of this file could not tell the two orderings apart. Clearing
   * `disarm` AFTER the body instead of before wipes the handle the body just installed — the timer
   * keeps running, `@destroyed` finds nothing to clear, and the component is held alive by a callback
   * nobody can name. Both orders pass every other test here.
   */
  test("a body that re-arms is still cleared by teardown", async () => {
    class Chain extends Component {
      tick = this.use(Timer);

      start() {
        this.tick.after(100, () => {
          log.push("tick");
          this.tick.after(100, () => log.push("second"));
        });
      }

      render(): RamondaNode {
        return <i />;
      }
    }

    const app = await getDOM<Chain>(<Chain />);
    app.instance.start();

    vi.advanceTimersByTime(100);
    expect(log).toEqual(["tick"]);
    expect(vi.getTimerCount()).toBe(1);

    app.unmount();
    vi.advanceTimersByTime(1000);
    expect(log).toEqual(["tick"]);
    expect(vi.getTimerCount()).toBe(0);
  });

  /**
   * `stop()` called from inside the body must stand. `disarm` is cleared BEFORE the body runs, so
   * this cannot un-clear a timeout that has already fired — without that ordering, a body that
   * re-arms and then stops would leave the re-armed timer running.
   */
  test("a body that re-arms and then stops leaves nothing armed", async () => {
    class Loop extends Component {
      tick = this.use(Timer);

      start() {
        this.tick.after(100, () => {
          log.push("tick");
          this.tick.after(100, () => log.push("again"));
          this.tick.stop();
        });
      }

      render(): RamondaNode {
        return <i />;
      }
    }

    const app = await getDOM<Loop>(<Loop />);
    app.instance.start();

    vi.advanceTimersByTime(1000);
    expect(log).toEqual(["tick"]);
    expect(vi.getTimerCount()).toBe(0);
    app.unmount();
  });
});

describe("repeat", () => {
  class Clock extends Component {
    ticker = this.use(Timer);

    start(ms = 1000) {
      this.ticker.repeat(ms, () => log.push("tick"));
    }

    halt() {
      this.ticker.stop();
    }

    render(): RamondaNode {
      return <i />;
    }
  }

  test("repeats until stopped", async () => {
    const app = await getDOM<Clock>(<Clock />);
    app.instance.start(1000);

    vi.advanceTimersByTime(3000);
    expect(log).toEqual(["tick", "tick", "tick"]);

    app.instance.halt();
    vi.advanceTimersByTime(5000);
    expect(log).toHaveLength(3);
    app.unmount();
  });

  /**
   * The one case where restarting is not a preference but the only correct answer: two intervals on
   * one name would both keep firing and nothing could name either.
   */
  test("starting twice leaves ONE interval running", async () => {
    const app = await getDOM<Clock>(<Clock />);
    app.instance.start(1000);
    app.instance.start(1000);

    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(2000);
    expect(log).toEqual(["tick", "tick"]);
    app.unmount();
  });

  test("unmount stops it", async () => {
    const app = await getDOM<Clock>(<Clock />);
    app.instance.start(1000);
    vi.advanceTimersByTime(1000);
    app.unmount();

    vi.advanceTimersByTime(10000);
    expect(log).toEqual(["tick"]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("two timers on one component", () => {
  test("are independent, and each `stop()` reaches only its own", async () => {
    class Two extends Component {
      first = this.use(Timer);
      second = this.use(Timer);

      arm() {
        this.first.after(100, () => log.push("first"));
        this.second.after(200, () => log.push("second"));
      }

      render(): RamondaNode {
        return <i />;
      }
    }

    const app = await getDOM<Two>(<Two />);
    app.instance.arm();
    app.instance.first.stop();

    vi.advanceTimersByTime(500);
    expect(log).toEqual(["second"]);
    app.unmount();
  });
});

describe("inside a hook", () => {
  /**
   * A hook of a hook, because that is the shape the first real caller has: `ViewTransition` holds a
   * deadline of its own. A hook's `@destroyed` runs with its owner's, so the teardown guarantee has
   * to survive one level down.
   */
  test("a hook's own timer is cleared when the owner unmounts", async () => {
    class Deadline extends Hook {
      private net = this.use(Timer);

      arm(ms: number) {
        this.net.after(ms, () => log.push("deadline"));
      }

      met() {
        this.net.stop();
      }
    }

    class Owner extends Component {
      deadline = this.use(Deadline);

      render(): RamondaNode {
        return <i />;
      }
    }

    const armed = await getDOM<Owner>(<Owner />);
    armed.instance.deadline.arm(1000);
    armed.instance.deadline.met();
    vi.advanceTimersByTime(5000);
    expect(log).toEqual([]);

    const dropped = await getDOM<Owner>(<Owner />);
    dropped.instance.deadline.arm(1000);
    dropped.unmount();
    vi.advanceTimersByTime(5000);
    expect(log).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("a server render", () => {
  /**
   * Nothing is armed while a page is being turned into a string: the timer could not fire before the
   * response is sent, and the request would be held open by a handle nobody can reach.
   *
   * It returns quietly rather than throwing, and THAT is what makes it safe to call from shared code
   * — the same `@created` runs on both sides, so a throw would force the call site to branch on which
   * side it is, which is the one thing the hydration rules tell an author not to do.
   */
  test("arming from a shared lifecycle does nothing, and does not throw", async () => {
    class OnBoth extends Component {
      private t = this.use(Timer);

      @destroyed
      noop() {}

      render(): RamondaNode {
        // Armed during the render pass rather than from `@created`, which is the earliest a server
        // render reaches — and the point is that it is silent, not that it is refused.
        this.t.after(1000, () => log.push("server"));
        this.t.repeat(1000, () => log.push("server-repeat"));
        return <i />;
      }
    }

    const html = await renderToString(<OnBoth />);

    expect(html).toContain("<i");
    expect(log).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);

    vi.advanceTimersByTime(10000);
    expect(log).toEqual([]);
  });
});

describe("what arming REPORTS", () => {
  /**
   * A refusal is otherwise indistinguishable from a timer that has not fired yet, and the first caller
   * proved why that matters: `ViewTransition` hands the promise `after` is meant to settle straight to
   * `startViewTransition`, so a silent refusal left the browser holding a snapshot over the page.
   */
  test("true when it arms, false once the owner is gone", async () => {
    const app = await getDOM<Card>(<Card />);

    expect(app.instance.removal.after(100, () => log.push("armed"))).toBe(true);
    expect(app.instance.removal.repeat(100, () => log.push("armed"))).toBe(true);

    app.instance.removal.stop();
    app.unmount();

    expect(app.instance.removal.after(100, () => log.push("late"))).toBe(false);
    expect(app.instance.removal.repeat(100, () => log.push("late"))).toBe(false);

    vi.advanceTimersByTime(1000);
    expect(log).toEqual([]);
  });

  test("false during a server render, where nothing can be armed", async () => {
    const armed: boolean[] = [];

    class OnBoth extends Component {
      private t = this.use(Timer);

      render(): RamondaNode {
        armed.push(this.t.after(1000, () => log.push("server")));
        return <i />;
      }
    }

    await renderToString(<OnBoth />);

    expect(armed).toEqual([false]);
    expect(log).toEqual([]);
  });
});

describe("a delay that is not one", () => {
  /**
   * DEV-only, and the judgement is `delayFault`'s — the same one `@interval("1s")` fails on, so the
   * decorator and the hook cannot disagree about what a delay is. The message names the METHOD,
   * because here the number arrived at runtime and the call site is what has to be found.
   */
  test("throws, naming the method", async () => {
    class Bad extends Component {
      t = this.use(Timer);
      render(): RamondaNode {
        return <i />;
      }
    }

    const app = await getDOM<Bad>(<Bad />);

    expect(() => app.instance.t.after(Number.NaN, () => {})).toThrow(/\[Timer\.after\].*number of milliseconds/s);
    expect(() => app.instance.t.repeat(-1, () => {})).toThrow(/\[Timer\.repeat\].*not be negative/s);
    // And nothing was armed by the attempt.
    expect(vi.getTimerCount()).toBe(0);
    app.unmount();
  });

  /**
   * The 32-bit ceiling, and it is a live case rather than a curiosity: `after(target - Date.now(), run)`
   * for a target further out than 24.8 days is an ordinary thing to compute, and `setTimeout` truncates
   * it — so late silently becomes IMMEDIATE, which is the opposite of what was asked for.
   */
  test("a delay past what setTimeout can hold is refused, not truncated", async () => {
    const app = await getDOM<Card>(<Card />);

    expect(() => app.instance.removal.after(2_147_483_648, () => log.push("now"))).toThrow(
      /\[Timer\.after\].*at most 2147483647 ms/s,
    );
    // The boundary itself is legal, so the message is about what the platform cannot hold rather than
    // about a number somebody picked.
    expect(app.instance.removal.after(2_147_483_647, () => log.push("someday"))).toBe(true);

    vi.advanceTimersByTime(10_000);
    expect(log).toEqual([]);
    app.unmount();
  });

  /**
   * A call that throws changes NOTHING, which is why the delay is checked before the restart.
   *
   * The other order is the plausible one to write — clear, then validate — and it would take a working
   * timer away over a typo in the new delay, leaving the component with neither.
   */
  test("a bad delay leaves an already-armed timer running", async () => {
    const app = await getDOM<Card>(<Card />);
    app.instance.leave(500);

    expect(() => app.instance.removal.after(Number.NaN, () => {})).toThrow(/\[Timer\.after\]/);

    vi.advanceTimersByTime(500);
    expect(log).toEqual(["left"]);
    app.unmount();
  });
});
