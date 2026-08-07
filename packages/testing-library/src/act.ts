import { flushSync } from "@ramonda/core/testing";

/**
 * How many microtask turns `act` gives an async callback's continuations after
 * it resolves.
 *
 * A promise chain resolves one turn at a time, so `await fetchThing()` inside
 * the callback can leave a `.then` still queued when the callback itself is
 * done. Each turn here lets one more link run and then commits whatever it
 * wrote. Ten is far past any realistic chain and costs nothing — an empty turn
 * is a resolved promise and a flush over two empty queues.
 *
 * It is not a substitute for awaiting the right thing. If a test needs a real
 * timer or a network round trip, `waitFor` is the tool; this only covers work
 * that is already scheduled.
 */
const MICROTASK_TURNS = 10;

/**
 * Runs `callback` and commits everything it caused before returning.
 *
 * Ramonda batches updates through a microtask, so a state write does not touch
 * the DOM until the next tick. `act` closes that gap: after the callback, every
 * pending render, every `@mounted` and every effect has run, and the DOM is what a
 * user would see.
 *
 * ```ts
 * act(() => { instance.count = 5; });
 * expect(screen.getByText("5")).toBeTruthy();
 * ```
 *
 * `render`, `rerender`, `fireEvent` and `renderHook` already wrap themselves in
 * it. Reach for it directly when a test changes state by hand — which in Ramonda
 * is common, because state is a field on a component instance rather than
 * something only an event can reach.
 *
 * **Async form.** If the callback returns a promise, so does `act`, and it
 * awaits the callback before flushing:
 *
 * ```ts
 * await act(async () => { await loadUser(); });
 * ```
 *
 * Its value is passed through, so `const user = await act(() => loadUser())`
 * works.
 *
 * **The overload order is load-bearing.** The promise signature has to come first, because a
 * `() => void` parameter accepts a function returning ANYTHING — that is what `void` means in a return
 * position — so with the sync overload first, `act(async () => {})` matched it and typed as `void`.
 * Everything still worked at runtime (the implementation looks at what came back, not at what was
 * declared), and the only visible symptom was an editor telling the truth on every line of every async
 * test: *"'await' has no effect on the type of this expression."* Which is how Nikola found it.
 */
export function act<T>(callback: () => PromiseLike<T>): Promise<T>;
export function act(callback?: () => void): void;
export function act<T>(callback?: () => T | PromiseLike<T>): void | Promise<T> {
  const result = callback?.();

  if (isThenable(result)) {
    return settleAsync(result);
  }

  flushSync();
  return undefined;
}

async function settleAsync<T>(pending: PromiseLike<T>): Promise<T> {
  const value = await pending;

  for (let turn = 0; turn < MICROTASK_TURNS; turn++) {
    // Flush first: the callback may have written state before it resolved, and
    // a continuation scheduled below should see a committed DOM.
    flushSync();
    await Promise.resolve();
  }
  flushSync();

  return value;
}

function isThenable<T>(value: unknown): value is PromiseLike<T> {
  return typeof value === "object" && value !== null && typeof (value as PromiseLike<T>).then === "function";
}
