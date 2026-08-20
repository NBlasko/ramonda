import { describe, test, expect } from "vitest";
import { getDOM } from "../test/setup";
import { catchError, compute, created, memoized, mounted, state } from "../base/decorators";
import { Component } from "../base/Component";
import type { RamondaNode } from "../types/vdom";

/**
 * `render` is the one member core reserves, and until this it was reserved only by TypeScript's
 * `abstract` — a build with no types refused nothing, and the two worst outcomes said nothing
 * either.
 *
 * Measured, one class per decorator, and TWO of these have since changed — the note says which:
 * - `@compute render()` — it CACHES. A state write and a props change still reach the DOM, and anything
 *   the render read that is NOT a signal freezes: `__tests__/prod/ComputeOnRender.prod.test.tsx` has the
 *   four measurements. It used to throw `component.render is not a function`, because the method form
 *   installed an accessor; it installs a function now.
 * - `@memoized render()` — no throw, and it CACHES: measured `"1" -> "2"`, because a memoised builder's
 *   reads invalidate their own entry. It froze on everything before that existed, which is what the
 *   sentence here used to say.
 * - `@created`, `@catchError`, `@state` — mounted and rendered, quietly meaning something else.
 *
 * A class body is evaluated when the module is imported, so each case is built inside its own
 * arrow: the decorator has to run where the expectation can catch it.
 */
describe("render takes no decorator", () => {
  const refused = (build: () => unknown) => expect(build).toThrow(/`render` does not take this decorator/);

  /**
   * The two that CACHE are allowed now, and this is the pair that used to be refused.
   *
   * Forbidding them protected nobody: `@compute get body()` returned from `render` does the same thing and
   * was always legal — measured, it blinds RMD020 and freezes on a plain field exactly the same way. So the
   * ban cost one wrapper and taught that the rule was arbitrary. What replaced it is a report: RMD020 says
   * a render is cached, which is the case it cannot see into. See `debug/cachedRender.ts`.
   */
  test("the two that cache are allowed", () => {
    expect(() => {
      class Cached extends Component {
        @compute
        render(): RamondaNode {
          return <span>x</span>;
        }
      }
      return Cached;
    }).not.toThrow();

    expect(() => {
      class Memoised extends Component {
        @memoized
        render(): RamondaNode {
          return <span>x</span>;
        }
      }
      return Memoised;
    }).not.toThrow();
  });

  /** A GETTER named `render` is still refused by TypeScript itself: it cannot override a method. */
  test("a getter named render is a type error, whatever the decorator", () => {
    class Broken extends Component {
      // @ts-expect-error a getter cannot override the base class's method
      @compute get render(): RamondaNode {
        return <span>x</span>;
      }
    }
    void Broken;
    expect(true).toBe(true);
  });

  test("a lifecycle decorator, which would run the render outside the render pass", () => {
    refused(() => {
      class Early extends Component {
        @created
        render(): RamondaNode {
          return <span>x</span>;
        }
      }
      return Early;
    });
    refused(() => {
      class Late extends Component {
        @mounted
        render(): RamondaNode {
          return <span>x</span>;
        }
      }
      return Late;
    });
  });

  test("the error handler, and state", () => {
    refused(() => {
      class Handling extends Component {
        @catchError
        render(): RamondaNode {
          return <span>x</span>;
        }
      }
      return Handling;
    });
    refused(() => {
      class Serialised extends Component {
        @state render = (): RamondaNode => <span>x</span>;
      }
      return Serialised;
    });
  });

  /**
   * The silence that matters as much: a member named anything else takes its decorator as before,
   * and so does an ordinary `render` with none.
   */
  test("everything else is untouched", async () => {
    class Ordinary extends Component {
      @state n = 0;
      @compute get label(): string {
        return `n is ${this.n}`;
      }
      render(): RamondaNode {
        return <span>{this.label}</span>;
      }
    }
    const mountedOrdinary = await getDOM<Ordinary>(<Ordinary />);
    expect(mountedOrdinary.container.textContent).toBe("n is 0");
    mountedOrdinary.instance.n = 1;
    await mountedOrdinary.settle();
    expect(mountedOrdinary.container.textContent).toBe("n is 1");
  });
});
