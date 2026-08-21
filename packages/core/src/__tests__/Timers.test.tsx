import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Component } from "../base/Component";
import { destroyed, mounted, state } from "../base/decorators";
import { Hook } from "../base/Hook";
import { Interval, Timeout } from "../base/Timers";
import { renderToString } from "../hydration/ssr";
import { getDOM } from "../test/setup";
import type { RamondaNode } from "../types/vdom";

/**
 * `Timeout` and `Interval` — a scheduled call the app starts, and the framework still owns.
 *
 * The decorators cover "run this on a clock while I am on the page". These cover "start now, stop when
 * I say", which no decorator can express: a decorator fires relative to MOUNT.
 *
 * **The half that matters most is teardown**, because that is the leak they exist to make impossible. A
 * raw `setTimeout` started on a click keeps the component alive and then writes into something that is
 * gone — `RMD008` drops the write, so the symptom is a handler that quietly does nothing. Every start
 * here is asserted to be silent after unmount.
 *
 * **The other half is where each value is read**, and that is the whole reason `run` sits in the props
 * bag while `ms` is an argument. Both are pinned below.
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
  removal = this.use(Timeout, () => ({ run: this.leave }));

  private leave() {
    this.gone = true;
    log.push("left");
  }

  render(): RamondaNode {
    return <div>{this.gone ? "gone" : "here"}</div>;
  }
}

describe("Timeout", () => {
  test("runs once, at the delay and not before", async () => {
    const app = await getDOM<Card>(<Card />);
    app.instance.removal.start(500);

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

    app.instance.removal.start(100);
    vi.advanceTimersByTime(100);
    await app.settle();

    expect(app.container.textContent).toBe("gone");
    app.unmount();
  });

  test("`stop()` before the delay cancels it", async () => {
    const app = await getDOM<Card>(<Card />);
    app.instance.removal.start(500);
    app.instance.removal.stop();

    vi.advanceTimersByTime(5000);
    expect(log).toEqual([]);
    app.unmount();
  });

  test("`stop()` with nothing running is not an error", async () => {
    const app = await getDOM<Card>(<Card />);
    expect(() => app.instance.removal.stop()).not.toThrow();
    app.unmount();
  });

  /**
   * Starting again RESTARTS, which is the rule that lets `stop()` need no handle: one hook instance is
   * one timer. The first delay is asserted to be GONE rather than merely late — a second timer left
   * running is the failure this pins.
   */
  test("starting again restarts, and the first delay never fires", async () => {
    const app = await getDOM<Card>(<Card />);
    app.instance.removal.start(500);
    vi.advanceTimersByTime(400);
    app.instance.removal.start(500);

    // 100ms short of the SECOND delay, and 500 past where the first one would have fired.
    vi.advanceTimersByTime(400);
    expect(log).toEqual([]);

    vi.advanceTimersByTime(100);
    expect(log).toEqual(["left"]);
    app.unmount();
  });

  /** The leak, and the reason these exist. */
  test("unmount before the delay clears it", async () => {
    const app = await getDOM<Card>(<Card />);
    app.instance.removal.start(1000);
    app.unmount();

    vi.advanceTimersByTime(5000);
    expect(log).toEqual([]);
  });

  /**
   * Starting AFTER teardown is the second half of the same leak, and it is not the same case:
   * `@destroyed` has already run, so nothing would ever clear this one. A late `await` landing in a
   * handler is exactly how it happens.
   */
  test("starting after the owner is gone does nothing", async () => {
    const app = await getDOM<Card>(<Card />);
    app.unmount();
    app.instance.removal.start(1000);

    vi.advanceTimersByTime(5000);
    expect(log).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("a body that starts it again", () => {
  class Chain extends Component {
    tick = this.use(Timeout, () => ({ run: this.again }));

    private again() {
      log.push("tick");
      this.tick.start(100);
    }

    render(): RamondaNode {
      return <i />;
    }
  }

  /**
   * The re-started timer is the one teardown has to reach.
   *
   * Planted, because the first version of this could not tell the two orderings apart: clearing the
   * handle AFTER the body instead of before wipes the one the body just installed — the timer keeps
   * running, teardown finds nothing to clear, and the component is held alive by a callback nobody can
   * name. **Every other test here passes under both orderings.**
   */
  test("is still cleared by teardown", async () => {
    const app = await getDOM<Chain>(<Chain />);
    app.instance.tick.start(100);

    vi.advanceTimersByTime(100);
    expect(log).toEqual(["tick"]);
    expect(vi.getTimerCount()).toBe(1);

    app.unmount();
    vi.advanceTimersByTime(1000);
    expect(log).toEqual(["tick"]);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("and a `stop()` from inside the body stands", async () => {
    class Once extends Component {
      tick = this.use(Timeout, () => ({ run: this.body }));

      private body() {
        log.push("tick");
        this.tick.start(100);
        this.tick.stop();
      }

      render(): RamondaNode {
        return <i />;
      }
    }

    const app = await getDOM<Once>(<Once />);
    app.instance.tick.start(100);

    vi.advanceTimersByTime(1000);
    expect(log).toEqual(["tick"]);
    expect(vi.getTimerCount()).toBe(0);
    app.unmount();
  });
});

describe("Interval", () => {
  class Clock extends Component {
    ticker = this.use(Interval, () => ({ run: this.tick }));

    private tick() {
      log.push("tick");
    }

    render(): RamondaNode {
      return <i />;
    }
  }

  test("repeats until stopped", async () => {
    const app = await getDOM<Clock>(<Clock />);
    app.instance.ticker.start(1000);

    vi.advanceTimersByTime(3000);
    expect(log).toEqual(["tick", "tick", "tick"]);

    app.instance.ticker.stop();
    vi.advanceTimersByTime(5000);
    expect(log).toHaveLength(3);
    app.unmount();
  });

  /**
   * The one case where restarting is not a preference but the only correct answer: two intervals on one
   * name would both keep firing and nothing could name either.
   */
  test("starting twice leaves ONE interval running", async () => {
    const app = await getDOM<Clock>(<Clock />);
    app.instance.ticker.start(1000);
    app.instance.ticker.start(1000);

    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(2000);
    expect(log).toEqual(["tick", "tick"]);
    app.unmount();
  });

  test("a second start changes the rate, because `ms` belongs to the start", async () => {
    const app = await getDOM<Clock>(<Clock />);
    app.instance.ticker.start(1000);
    vi.advanceTimersByTime(1000);
    expect(log).toHaveLength(1);

    app.instance.ticker.start(100);
    vi.advanceTimersByTime(300);
    expect(log).toHaveLength(4);
    app.unmount();
  });

  test("unmount stops it", async () => {
    const app = await getDOM<Clock>(<Clock />);
    app.instance.ticker.start(1000);
    vi.advanceTimersByTime(1000);
    app.unmount();

    vi.advanceTimersByTime(10000);
    expect(log).toEqual(["tick"]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

/**
 * Where each value is read, which is the reason the two live in two places.
 *
 * `run` is a property of the TIMER, so it sits with the declaration and is read when the call fires.
 * `ms` is a property of THIS start — a retry's backoff differs every time — so it is an argument, and
 * no signal has to be watched for it to change.
 */
describe("what is read when", () => {
  class Toggling extends Component {
    @state paused = false;
    beat = this.use(Interval, () => ({ run: this.paused ? this.hold : this.tick }));

    private tick() {
      log.push("tick");
    }

    private hold() {
      log.push("hold");
    }

    render(): RamondaNode {
      return <i>{this.paused ? "paused" : "running"}</i>;
    }
  }

  test("`run` is read when it FIRES, so a signal can swap it mid-flight", async () => {
    const app = await getDOM<Toggling>(<Toggling />);
    app.instance.beat.start(100);

    vi.advanceTimersByTime(100);
    expect(log).toEqual(["tick"]);

    app.instance.paused = true;
    await app.settle();

    vi.advanceTimersByTime(100);
    expect(log).toEqual(["tick", "hold"]);
    app.unmount();
  });

  /**
   * And swapping it CANCELS NOTHING. Two reasons, and the second is why it needs no code: the props bag
   * re-runs whenever any signal it read changes, including one read for an unrelated purpose, so an
   * auto-cancel would let an unrelated re-render silently kill a running timer. Cancelling is `stop()`.
   */
  test("swapping `run` does not cancel what is waiting", async () => {
    class Pending extends Component {
      @state swapped = false;
      t = this.use(Timeout, () => ({ run: this.swapped ? this.second : this.first }));

      private first() {
        log.push("first");
      }

      private second() {
        log.push("second");
      }

      render(): RamondaNode {
        return <i>{this.swapped ? "b" : "a"}</i>;
      }
    }

    const app = await getDOM<Pending>(<Pending />);
    app.instance.t.start(1000);

    vi.advanceTimersByTime(400);
    app.instance.swapped = true;
    await app.settle();

    // Still one timer, and still the ORIGINAL deadline: 600ms left, not 1000 from now.
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(600);
    expect(log).toEqual(["second"]);
    app.unmount();
  });
});

describe("two timers on one component", () => {
  test("are independent, and each `stop()` reaches only its own", async () => {
    class Two extends Component {
      first = this.use(Timeout, () => ({ run: this.one }));
      second = this.use(Timeout, () => ({ run: this.two }));

      private one() {
        log.push("first");
      }

      private two() {
        log.push("second");
      }

      render(): RamondaNode {
        return <i />;
      }
    }

    const app = await getDOM<Two>(<Two />);
    app.instance.first.start(100);
    app.instance.second.start(200);
    app.instance.first.stop();

    vi.advanceTimersByTime(500);
    expect(log).toEqual(["second"]);
    app.unmount();
  });
});

describe("inside a hook", () => {
  /**
   * A hook of a hook, because that is the shape the first real caller has: `ViewTransition` holds a
   * deadline of its own. A hook's `@destroyed` runs with its owner's, so the teardown guarantee has to
   * survive one level down.
   */
  test("a hook's own timer is cleared when the owner unmounts", async () => {
    class Deadline extends Hook {
      private net = this.use(Timeout, () => ({ run: this.expired }));

      arm(ms: number) {
        this.net.start(ms);
      }

      met() {
        this.net.stop();
      }

      private expired() {
        log.push("deadline");
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

describe("what `start` reports", () => {
  /**
   * A refusal is otherwise indistinguishable from a timer that has not fired yet, and the first caller
   * proved why that matters: `ViewTransition` hands the promise `start` is meant to settle straight to
   * `startViewTransition`, so a silent refusal left the browser holding a snapshot over the page.
   */
  test("true when it starts, false once the owner is gone", async () => {
    const app = await getDOM<Card>(<Card />);

    expect(app.instance.removal.start(100)).toBe(true);
    app.instance.removal.stop();
    app.unmount();

    expect(app.instance.removal.start(100)).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(log).toEqual([]);
  });

  test("false during a server render, where nothing can be started", async () => {
    const started: boolean[] = [];

    class OnBoth extends Component {
      private t = this.use(Timeout, () => ({ run: this.never }));

      private never() {
        log.push("server");
      }

      render(): RamondaNode {
        started.push(this.t.start(1000));
        return <i />;
      }
    }

    await renderToString(<OnBoth />);

    expect(started).toEqual([false]);
    expect(log).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

/**
 * The two windows a review found, where the guard read a field that was not yet — or no longer — true.
 * Both were reachable, both fired, and both are the leak this hook exists to make impossible.
 */
describe("the windows where the owner's flags lie", () => {
  /**
   * `ComponentRuntime.env` is `"client"` until `DiffAndMerge` assigns it, which happens AFTER the
   * component and its hooks are constructed. So a `start` from a field initializer read "client"
   * during a server render: measured before the fix, it armed a timer in the SSR process and fired it.
   */
  test("a start from a field initializer during a server render is refused", async () => {
    const started: boolean[] = [];

    class Early extends Component {
      t = this.use(Timeout, () => ({ run: this.never }));
      armed = this.record(this.t.start(100));

      private record(ok: boolean): boolean {
        started.push(ok);
        return ok;
      }

      private never() {
        log.push("server");
      }

      render(): RamondaNode {
        return <i />;
      }
    }

    await renderToString(<Early />);

    expect(started).toEqual([false]);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(log).toEqual([]);
  });

  /**
   * The window the flag-and-field pair still had: a component built during `drainServerWork`, where the
   * module flag has been restored to `"client"` in `renderToString`'s `finally` AND the field is still
   * its `"client"` default. Measured before the fix: the timer armed in the SSR process and fired
   * there. The guard asks `isInitialized` now, so the answer does not depend on the side being known.
   */
  test("a start from a field initializer during the async server drain is refused", async () => {
    const started: boolean[] = [];

    class Late extends Component {
      t = this.use(Timeout, () => ({ run: this.never }));
      armed = this.record(this.t.start(100));

      private record(ok: boolean): boolean {
        started.push(ok);
        return ok;
      }

      private never() {
        log.push("drained");
      }

      render(): RamondaNode {
        return <b />;
      }
    }

    class Slow extends Component {
      @state ready = false;

      @mounted
      async load() {
        await Promise.resolve();
        this.ready = true;
      }

      render(): RamondaNode {
        return <div>{this.ready ? <Late /> : null}</div>;
      }
    }

    const html = await renderToString(<Slow />);

    expect(html).toContain("<b");
    expect(started).toEqual([false]);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(log).toEqual([]);
  });

  /**
   * `isDestroyed` is set AFTER the whole teardown pass, so during `@destroyed` it still reads `false`.
   * Measured before the fix: `start(50)` returned `true`, left a live timer and fired it after unmount,
   * with nothing left to clear it — and `RMD006` cannot see it either, because the timer has no
   * lifecycle owner to be attributed to by then.
   */
  test("a start from `@destroyed` is refused", async () => {
    const started: boolean[] = [];

    class Late extends Component {
      t = this.use(Timeout, () => ({ run: this.never }));

      @destroyed
      bye() {
        started.push(this.t.start(50));
      }

      private never() {
        log.push("after-unmount");
      }

      render(): RamondaNode {
        return <i />;
      }
    }

    const app = await getDOM<Late>(<Late />);
    app.unmount();

    expect(started).toEqual([false]);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(log).toEqual([]);
  });

  /** And a running timer is still cleared by that same teardown, which is the half that must not break. */
  test("and one already running is still cleared", async () => {
    class Both extends Component {
      t = this.use(Timeout, () => ({ run: this.never }));

      @destroyed
      bye() {
        this.t.start(50);
      }

      private never() {
        log.push("fired");
      }

      render(): RamondaNode {
        return <i />;
      }
    }

    const app = await getDOM<Both>(<Both />);
    app.instance.t.start(1000);
    expect(vi.getTimerCount()).toBe(1);

    app.unmount();
    vi.advanceTimersByTime(5000);
    expect(log).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("a delay that is not one", () => {
  /**
   * The judgement is `delayFault`'s — the same one `@interval("1s")` fails on, so the decorator and the
   * hook cannot disagree about what a delay is. The message names the HOOK, because the number arrived
   * at runtime and the call site is what has to be found.
   */
  test("throws, naming the hook", async () => {
    const app = await getDOM<Card>(<Card />);

    expect(() => app.instance.removal.start(Number.NaN)).toThrow(/\[Timeout\.start\].*number of milliseconds/s);
    expect(() => app.instance.removal.start(-1)).toThrow(/\[Timeout\.start\].*not be negative/s);
    expect(vi.getTimerCount()).toBe(0);
    app.unmount();
  });

  /**
   * The 32-bit ceiling, and it is a live case rather than a curiosity: `start(target - Date.now())` for
   * a target further out than 24.8 days is an ordinary thing to compute, and `setTimeout` truncates it —
   * so late silently becomes IMMEDIATE, which is the opposite of what was asked for.
   */
  test("a delay past what setTimeout can hold is refused, not truncated", async () => {
    const app = await getDOM<Card>(<Card />);

    expect(() => app.instance.removal.start(2_147_483_648)).toThrow(/\[Timeout\.start\].*at most 2147483647 ms/s);
    // The boundary itself is legal, so the message is about what the platform cannot hold rather than
    // about a number somebody picked.
    expect(app.instance.removal.start(2_147_483_647)).toBe(true);

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
  test("a bad delay leaves an already-running timer alone", async () => {
    const app = await getDOM<Card>(<Card />);
    app.instance.removal.start(500);

    expect(() => app.instance.removal.start(Number.NaN)).toThrow(/\[Timeout\.start\]/);

    vi.advanceTimersByTime(500);
    expect(log).toEqual(["left"]);
    app.unmount();
  });
});
