import { fireEvent as domFireEvent } from "@testing-library/dom";
import { flushSync } from "@ramonda/core/testing";

type DomFireEvent = typeof domFireEvent;

/**
 * `fireEvent` from the DOM Testing Library, with the render it causes already
 * committed by the time it returns.
 *
 * Dispatching is synchronous but the render it triggers is not — Ramonda batches
 * through a microtask — so the raw version leaves the assertion one tick early
 * and the test reads the DOM as it was BEFORE the click. Every method here
 * flushes afterwards, so `fireEvent.click(button)` behaves the way its name
 * suggests.
 *
 * Import it from this package rather than from `@testing-library/dom`; the
 * unwrapped one is the version that silently reads stale DOM.
 */
function wrap<F extends (...args: never[]) => unknown>(fn: F): F {
  return ((...args: Parameters<F>) => {
    const result = fn(...(args as never[]));
    flushSync();
    return result;
  }) as F;
}

const wrapped = wrap(domFireEvent as (...args: never[]) => boolean);

// The DOM library hangs one helper per event type off the function itself
// (`fireEvent.click`, `fireEvent.change`, …). They are copied rather than
// proxied so the shape — and the types — stay exactly what a reader expects.
for (const key of Object.keys(domFireEvent) as (keyof DomFireEvent)[]) {
  const helper = domFireEvent[key];
  if (typeof helper === "function") {
    (wrapped as unknown as Record<string, unknown>)[key] = wrap(helper as (...args: never[]) => unknown);
  }
}

export const fireEvent = wrapped as unknown as DomFireEvent;
