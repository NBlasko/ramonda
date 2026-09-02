import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { getDOM } from "../test/setup";
import { Component } from "../base/Component";
import { created } from "../base/decorators";
import { resetDiagnostics } from "../debug/diagnostics";
import { installTimerGuard, reportLeakedTimers, timerOwner } from "../debug/timerGuard";

/**
 * What `debug/timerGuard.ts` promises, as opposed to the one case it was tested for.
 *
 * RMD006 itself is covered in `Diagnostics.test.tsx` — one interval, left running, reported. Six
 * more claims sat in this module's own comments with nothing exercising them, and the union of both
 * coverage runs put its unhit branches at the top of the package. Each is a promise a reader acts
 * on: that a component's SECOND timer is tracked too, that a missing delay reads as `0`, that
 * installing twice is safe, that clearing with no id is safe, and that with no DOM the guard does
 * nothing at all.
 *
 * ## The one that was not a promise but a defect, found by asking why the guard exists
 *
 * `installTimerGuard`'s `typeof window === "undefined"` branch is unhit in every suite, which reads
 * exactly like the dead guards deleted from `Listener` and `@onWindow`. It is not dead: this module
 * is loaded by `index.ts` at IMPORT time, before anything knows whether there is a DOM. And the
 * module next door, `debug/logger.ts`, did the same thing at module load WITHOUT the check — so
 * `import "@ramonda/core"` in a Node process with no DOM threw `ReferenceError: window is not
 * defined` before the caller's first line. Measured against `dist/index.js`, since the development
 * build is the `default` export condition and replaces `__DEV__` with `true`.
 */
describe("the timer guard's own promises", () => {
  let messages: string[];
  let stop: () => void;

  beforeEach(() => {
    resetDiagnostics();
    messages = [];
    vi.spyOn(console, "log").mockImplementation(() => {});
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as { message: string };
      if (detail.message.startsWith("[RMD006]")) messages.push(detail.message);
    };
    window.addEventListener("ramonda:dev-log", handler);
    stop = () => window.removeEventListener("ramonda:dev-log", handler);
  });

  afterEach(() => {
    stop();
    vi.restoreAllMocks();
  });

  /**
   * The second timer, which is `track`'s other branch: the first one creates the component's map,
   * every one after it finds it. Nothing had ever started two.
   */
  test("a component that leaks two timers is told about both", async () => {
    class Two extends Component {
      @created start() {
        setInterval(() => {}, 1_000);
        setInterval(() => {}, 2_000);
      }
      render() {
        return <div>x</div>;
      }
    }

    const app = await getDOM<Two>(<Two />);
    app.unmount();

    expect(messages).toHaveLength(2);
    expect(messages[0]).toContain("setInterval(…, 1000) still running");
    expect(messages[1]).toContain("setInterval(…, 2000) still running");
  });

  /**
   * And two IDENTICAL ones are one report, which is the dedup working rather than a timer lost.
   *
   * The key is `component:kind:ms`, so this is deliberate: two `setInterval(fn, 3000)` from one
   * component is one cause — the same line in a loop, usually — and the alternative is a console
   * with one entry per row of a list. The cost is named rather than hidden: two DIFFERENT lines
   * that happen to share a delay also report once.
   */
  test("two identical timers are one report, not two", async () => {
    class Same extends Component {
      @created start() {
        setInterval(() => {}, 3_000);
        setInterval(() => {}, 3_000);
      }
      render() {
        return <div>x</div>;
      }
    }

    const app = await getDOM<Same>(<Same />);
    app.unmount();

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("setInterval(…, 3000) still running");
  });

  /** `setInterval(fn)` is legal and means "as fast as possible". The report has to say a number. */
  test("an interval with no delay reads as 0 rather than as nothing", async () => {
    class NoMs extends Component {
      @created start() {
        (setInterval as unknown as (handler: () => void) => number)(() => {});
      }
      render() {
        return <div>x</div>;
      }
    }

    const app = await getDOM<NoMs>(<NoMs />);
    app.unmount();

    expect(messages[0]).toContain("setInterval(…, 0) still running");
  });

  /**
   * The same for a timeout, and the way this is driven is the finding of its own.
   *
   * `vi.useFakeTimers()` cannot be used to hold it pending: it replaces the globals AFTER the guard
   * patched them, so the timeout is never tracked and the test passes for the wrong reason —
   * measured, it reported nothing at all. `timerOwner` is what a lifecycle sets, so setting it here
   * is the same arrangement with no `await` between the call and the report, which a 0 ms timeout
   * would otherwise survive.
   */
  test("a timeout with no delay reads as 0, and is reported while still pending", async () => {
    class Bare extends Component {
      render() {
        return <div>x</div>;
      }
    }
    const app = await getDOM<Bare>(<Bare />);

    timerOwner.component = app.instance as never;
    const id = (setTimeout as unknown as (handler: () => void) => number)(() => {});
    timerOwner.component = undefined;
    reportLeakedTimers(app.instance as never);
    clearTimeout(id);

    expect(messages[0]).toContain("setTimeout(…, 0) still running");
    app.unmount();
  });

  /**
   * "Safe to call more than once", which is what `index.ts` relies on and nothing checked.
   *
   * Patching twice would wrap the wrapper: one timer tracked twice, and `untrack` clearing one of
   * the two entries — a leak reported for a timer that was cleared.
   */
  test("installing the guard again does not patch the patch", () => {
    const patched = window.setInterval;
    installTimerGuard();
    expect(window.setInterval).toBe(patched);
  });

  /**
   * Clearing with no id, which is legal and which nothing had called.
   *
   * This test is deliberately weaker than it looks, and it says so: it cannot prove the code that
   * handles the case, because `untrack` answers for a missing id by finding no owner. Two `if (id
   * != null)` checks used to sit in front of it and were DELETED for exactly that reason — removing
   * them left every test green, which is the definition of a branch nothing can justify. What is
   * left here is the promise a caller has: this throws nothing.
   */
  test("clearing with no id throws nothing", () => {
    expect(() => (clearTimeout as () => void)()).not.toThrow();
    expect(() => (clearInterval as () => void)()).not.toThrow();
  });

  /**
   * With no DOM, the guard installs nothing — the branch that reads like a dead one and is not.
   *
   * A fresh copy of the module is needed because `installed` is module state: the copy this suite
   * imported was patched when `index.ts` loaded. The import happens WHILE `window` is present, so
   * anything the module graph does at load time cannot be mistaken for what the function does when
   * there is no DOM — measured apart, because the first version of this probe deleted `window`
   * first and read an import-time throw as the function's.
   */
  test("with no window the guard installs nothing, and says so by returning", async () => {
    const saved = globalThis.window;
    vi.resetModules();
    const fresh = await import("../debug/timerGuard");

    // @ts-expect-error the absence of a DOM is the case under test
    delete globalThis.window;
    let threw: unknown;
    try {
      fresh.installTimerGuard();
    } catch (error) {
      threw = error;
    }
    globalThis.window = saved;

    expect(threw).toBeUndefined();
    // And nothing was patched: the fresh module never touched the globals it was handed none of.
    expect(typeof window.setInterval).toBe("function");
  });
});
