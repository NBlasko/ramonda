import { describe, expect, expectTypeOf, test } from "vitest";
import { Component, mount, state, type RamondaNode, updated } from "@ramonda/core";
import { render, act, waitFor } from "../index";

/**
 * `act` is the only thing in this package that Ramonda-specific knowledge is
 * required for. Everything else is the DOM Testing Library.
 *
 * The problem it solves: updates are batched through a microtask, so after a
 * state write the DOM is a tick behind. The harness this replaced offered
 * `settle: () => Promise.resolve()` and left the count to the test — one `await`
 * for a simple change, two or three for a cascade, discovered by trying. A test
 * with one too few read stale DOM and the fix was to add another and hope.
 */

class Counter extends Component {
  @state count = 0;
  render(): RamondaNode {
    return <p>count: {this.count}</p>;
  }
}

describe("act", () => {
  test("commits a state write before it returns", () => {
    const { instance, container } = render<Counter>(<Counter />);

    instance.count = 1;
    // Deliberately observed BEFORE the act: this is the gap act exists to close.
    const beforeFlush = container.textContent;

    act(() => {});

    expect(beforeFlush).toBe("count: 0");
    expect(container.textContent).toBe("count: 1");
  });

  test("settles a cascade, however deep, in one call", () => {
    // Three components chained so each one's render triggers the next: A's
    // @mount writes A, whose render feeds B, whose @effect writes C. Under the
    // old harness this needed a different number of `await settle()` calls than
    // a simple change did, and knowing WHICH was the test author's problem.
    const seen: number[] = [];

    class Chain extends Component {
      @state a = 0;
      @state b = 0;
      @state c = 0;

      @mount start() {
        this.a = 1;
      }

      @updated step() {
        if (this.a === 1 && this.b === 0) this.b = 2;
        if (this.b === 2 && this.c === 0) this.c = 3;
        seen.push(this.c);
      }

      render(): RamondaNode {
        return (
          <p>
            {this.a}-{this.b}-{this.c}
          </p>
        );
      }
    }

    const { container } = render(<Chain />);

    // render already act-wraps, so the whole cascade is done on arrival.
    expect(container.textContent).toBe("1-2-3");
    expect(seen.at(-1)).toBe(3);
  });

  test("returns a promise, and its value, when the callback is async", async () => {
    const { instance, container } = render<Counter>(<Counter />);

    const returned = await act(async () => {
      await Promise.resolve();
      instance.count = 5;
      return "done";
    });

    expect(returned).toBe("done");
    expect(container.textContent).toBe("count: 5");
  });

  test("drains promise continuations scheduled by the callback", async () => {
    const { instance, container } = render<Counter>(<Counter />);

    await act(async () => {
      // Resolves one turn AFTER the callback itself is done — the case a single
      // `await Promise.resolve()` would miss.
      void Promise.resolve()
        .then(() => Promise.resolve())
        .then(() => {
          instance.count = 9;
        });
    });

    expect(container.textContent).toBe("count: 9");
  });

  test("waitFor still works for genuinely async work", async () => {
    const { instance, getByText } = render<Counter>(<Counter />);

    // A real timer is beyond act's reach by design — act commits work that is
    // already scheduled, it does not travel forward in time.
    setTimeout(
      () =>
        act(() => {
          instance.count = 42;
        }),
      10,
    );

    await waitFor(() => expect(getByText("count: 42")).toBeTruthy());
  });

  /**
   * The TYPE, not the behaviour — and it needs asserting because it was wrong while every runtime test
   * here passed.
   *
   * With the sync overload declared first, `act(async () => {})` matched `() => void` (a void return
   * position accepts any value) and typed as `void`. The implementation looks at what came back rather
   * than at what was declared, so nothing misbehaved; the only symptom was every `await act(…)` in the
   * repo being told *"'await' has no effect on the type of this expression"*, which is how Nikola found
   * it. A runtime test cannot see that, so the assertion has to be about types.
   *
   * Enforced by `check-types`, not by this run: `expectTypeOf` compiles to nothing, so `vitest run`
   * reports 34 passing tests either way. Reordering the overloads fails `tsc --noEmit`, which is what
   * turbo runs — verified by putting the old order back.
   */
  test("an async callback types as a promise, a sync one as void", () => {
    expectTypeOf(act(async () => {})).toEqualTypeOf<Promise<void>>();
    expectTypeOf(act(() => {})).toEqualTypeOf<void>();
    // And the value passes through, which is the whole point of the promise overload.
    expectTypeOf(act(async () => 5)).toEqualTypeOf<Promise<number>>();
    expectTypeOf(act(() => Promise.resolve("x"))).toEqualTypeOf<Promise<string>>();
  });
});
