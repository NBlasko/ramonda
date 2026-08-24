import { describe, test, expect } from "vitest";
import { Component, state, bootstrap, unmount, memoized } from "../../index";
import { flushSync, getComponentInstance } from "../../testing";

/**
 * A memoized handler called with an argument it cannot key on, in PRODUCTION.
 *
 * The cache key is built from the arguments, and only a string, a number or a
 * boolean can be part of one — an object cannot be compared by value, and keying
 * on it by identity would never hit. So the argument is a mistake, and in
 * development it is a loud one.
 *
 * In production it used to be loud too: a plain `throw`, outside any `__DEV__`
 * guard, in the middle of a render. One handler receiving an object — an id that
 * is sometimes `{ id }` instead of `id`, a value that arrives as an object for
 * one user — took the whole page down. That is the opposite of what the rest of
 * the framework does with a mistake it meets at runtime: a list item that is not
 * an element is skipped so the list keeps rendering, a function in tag position is
 * called rather than crashing the page, a corrupt hydration blob is ignored so the
 * page still renders.
 *
 * So production degrades instead: the handler is not memoized — it is built fresh
 * for that call and nothing is cached — and everything else goes on working. The
 * cost is the identity churn memoization exists to prevent, which is a slower
 * page, not a broken one.
 */
describe("production: a handler key that cannot be built", () => {
  test("__DEV__ is false in this run", () => {
    expect(__DEV__).toBe(false);
  });

  test("the page keeps rendering, and the handler still works", () => {
    const calls: unknown[] = [];

    class Panel extends Component {
      @state label = "one";

      @memoized
      pick(id: unknown) {
        return () => calls.push(id);
      }

      render() {
        // The bad call and a good one, side by side: the object argument must not
        // stop the rest of the render.
        const bad = this.pick({ id: 7 } as unknown as string);
        const good = this.pick("7");
        return (
          <div>
            <div>
              <button id="bad" onclick={bad}>
                {this.label}
              </button>
              <button id="good" onclick={good}>
                ok
              </button>
            </div>
          </div>
        );
      }
    }

    const container = document.createElement("div");
    document.body.appendChild(container);

    // Rendering at all is the first assertion: this used to throw out of render.
    expect(() => {
      bootstrap(<Panel />, container);
      flushSync();
    }).not.toThrow();

    const bad = container.querySelector("#bad") as HTMLButtonElement;
    const good = container.querySelector("#good") as HTMLButtonElement;
    expect(bad).toBeTruthy();
    expect(good.textContent).toBe("ok");

    // The un-keyable handler is a real handler — it was built, just not cached.
    bad.click();
    good.click();
    expect(calls).toEqual([{ id: 7 }, "7"]);

    // And the component still updates.
    const instance = getComponentInstance(container.firstElementChild) as unknown as Panel;
    instance.label = "two";
    flushSync();
    expect(container.querySelector("#bad")!.textContent).toBe("two");

    unmount(container);
    container.remove();
  });

  test("a keyable argument is still memoized — the same handler comes back", () => {
    class Panel extends Component {
      @state tick = 0;
      handlers: unknown[] = [];

      @memoized
      pick(id: string) {
        return () => id;
      }

      render() {
        this.handlers.push(this.pick("a"));
        return (
          <div>
            <div>{this.tick}</div>
          </div>
        );
      }
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    bootstrap(<Panel />, container);
    flushSync();

    const instance = getComponentInstance(container.firstElementChild) as unknown as Panel;
    instance.tick = 1;
    flushSync();

    expect(instance.handlers.length).toBe(2);
    expect(instance.handlers[0]).toBe(instance.handlers[1]);

    unmount(container);
    container.remove();
  });
});
