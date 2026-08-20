import "@testing-library/jest-dom";
import { afterEach } from "vitest";
import userEvent from "@testing-library/user-event";

import { bootstrap } from "../";
import type { ComponentChild } from "../types/vdom";
import { unmountChildrenNodes } from "../core/DiffAndMerge";
import { flushSync } from "../testing";
import { configureDev } from "../";

const originalWindow = { ...window };

/**
 * Containers mounted by getDOM that are still in the document.
 *
 * They used to leak: getDOM appended to document.body and nothing ever removed
 * them, so every mount in a run piled up. That is not only memory — a leaked
 * container keeps a LIVE component tree, so its timers, effects and window
 * listeners stay armed and can report into a later test. It also broke scoped
 * `container.querySelector("#id")`: with the same id present in several leaked
 * containers, jsdom resolves even a scoped lookup through a document-wide id
 * index and returns the first match, which belongs to an earlier test. That
 * failure is invisible in isolation — the tests pass one at a time and fail
 * together.
 */
const liveContainers = new Set<HTMLElement>();

/**
 * Unique per mount, so two containers alive at once can never share an id —
 * which is what made the duplicate-id lookup above possible.
 *
 * Reset per test, not per run: the id ends up in at least one snapshot, and a
 * counter that kept climbing would make that snapshot depend on how many mounts
 * happened before it in the same worker.
 */
let containerSeq = 0;

function teardown(container: HTMLElement): void {
  // Unmount first: removing the node alone leaves the components mounted, so
  // @destroyed never runs and their subscriptions outlive the test.
  unmountChildrenNodes([container]);
  container.remove();
  liveContainers.delete(container);
}

// setup.ts is a vitest setupFile, so this runs after EVERY test in every file —
// a test does not have to remember to clean up, which is the only way a harness
// rule like this actually holds.
afterEach(() => {
  for (const container of [...liveContainers]) teardown(container);
  containerSeq = 0;
});

export async function getDOM<T = any>(component: ComponentChild) {
  const user = userEvent.setup();
  const div = document.createElement("div");
  div.setAttribute("id", `app-${++containerSeq}`);
  document.body.appendChild(div);
  liveContainers.add(div);

  bootstrap(component, div);
  await Promise.resolve();

  const findInstance = (node: Node): unknown => {
    // The instance is parked on the DOM node by the renderer, so the property is the untyped
    // part — not the node.
    const carrier = node as Node & { _componentInstance?: unknown };
    if (carrier._componentInstance) return carrier._componentInstance;
    for (const child of Array.from(node.childNodes)) {
      const found = findInstance(child);
      if (found) return found;
    }
    return null;
  };

  const instance = findInstance(div) as T;

  return {
    container: div,
    user,
    instance,
    /**
     * Commits every pending render, @mounted and effect.
     *
     * It used to be `() => Promise.resolve()` — one microtask turn — and that
     * left the COUNT to the caller. Measured: a plain state write needs one
     * `await settle()`, but a cascade (an @updated writing state that its own
     * render reads) needs two, and a deeper one needs three. Nothing said which
     * you were in, so tests were written with an extra await "to be safe" and
     * the ones with too few read stale DOM.
     *
     * Now it drains until both queues are empty, so one call is always enough
     * and the number is never a question. Still a promise, because every caller
     * awaits it and there is no reason to make them stop.
     */
    settle: () => {
      flushSync();
      return Promise.resolve();
    },
    // Idempotent: teardown deregisters, so calling this and then letting
    // afterEach run does not unmount twice.
    unmount: () => {
      teardown(div);
    },

    [Symbol.dispose]() {
      this.unmount();
    },
  };
}

export function changeInitialUrlPath(pathname: string) {
  Object.defineProperty(window, "location", {
    value: { pathname: pathname },
    writable: true,
  });
}

export function restoreWindowObjectChanges() {
  Object.keys(window).forEach((key) => {
    if (!(key in originalWindow)) {
      Reflect.deleteProperty(window, key);
    }
  });

  Object.assign(window, originalWindow);
}

/**
 * This file is the framework's OWN harness. The one for applications is
 * `@ramonda/testing-library` — `render`, `renderHook`, `act`, `fireEvent`,
 * automatic cleanup, and every query re-exported from `@testing-library/dom`.
 *
 * **Why they are not the same file.** That package depends on `@ramonda/core`.
 * Core's tests depending on it back would be a dependency cycle: pnpm would
 * resolve it, and `turbo run build` — whose `^build` follows devDependencies too
 * — would refuse it. A framework whose own tests ran on its published testing
 * library would have the same cycle to answer for.
 *
 * So this stays, deliberately small, and the two share what actually matters:
 * `flushSync` from `src/testing.ts`, which is the seam the package sits on. The
 * commit semantics a test sees are therefore the same on both sides, and the
 * part most likely to drift cannot.
 */

// RMD020 renders every component twice in a development build to catch values built
// in place. These suites deliberately log from `render()` to observe render ORDER —
// which is exactly the impurity the check reports — so a doubled render would double
// those logs and break assertions that count them. Off here; the RMD020 tests turn
// it back on for themselves.
configureDev({ strictRender: false });
