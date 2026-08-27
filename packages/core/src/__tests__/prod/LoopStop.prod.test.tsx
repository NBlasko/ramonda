import { describe, test, expect } from "vitest";
import { Component, state, bootstrap, unmount } from "../../index";
import { flushSync, getComponentInstance } from "../../testing";

/**
 * The production update-loop stop — only reachable with `__DEV__` false.
 *
 * In development a runaway render is caught early and by name (RMD009 /
 * `isRunawayUpdate`), and that path is stripped from production. What remains is
 * the blunt `MAX_BUILDS_PER_DRAIN` counter in Task.ts, whose only job is to end a
 * loop before it freezes the tab. This run exists to prove it does.
 *
 * See `vitest.prod.config.ts` for why this is a separate process.
 */

describe("production update-loop stop", () => {
  // __TEST__ carries NODE_ENV, so this run is genuinely the production one — if it
  // weren't, RMD009 would end the loop first and the assertion below would be
  // testing nothing.
  test("__DEV__ is false in this run", () => {
    expect(__DEV__).toBe(false);
  });

  test("a render that never settles is stopped, not left to freeze the tab", () => {
    class Runaway extends Component {
      @state n = 0;
      render() {
        // A write inside render: each rebuild schedules the next, forever.
        this.n = this.n + 1;
        return (
          <div>
            <span>{this.n}</span>
          </div>
        );
      }
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    bootstrap(<Runaway />, container);

    // The initial render's write happens before the component is initialized, so
    // it is dropped and no loop starts. One write afterwards kicks off the first
    // rebuild — and from there render() keeps scheduling itself.
    const inst = getComponentInstance(container.firstElementChild) as unknown as Runaway;
    inst.n = inst.n + 1;

    try {
      // flushSync drains synchronously, so the loop stop throws here rather than
      // out of a microtask nobody awaited.
      expect(() => flushSync()).toThrow(/Update loop/);
    } finally {
      unmount(container);
      container.remove();
    }
  }, 30_000);
});
