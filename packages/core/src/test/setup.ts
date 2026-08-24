import "@testing-library/jest-dom";
import { afterEach } from "vitest";
import userEvent from "@testing-library/user-event";

import { bootstrap } from "../";
import type { ComponentChild, ComponentRegion } from "../types/vdom";
import { COMPONENT_RUNTIME } from "../core/runtime";
import { componentAt, componentsIn, unmountChildrenNodes } from "../core/DiffAndMerge";
import { markComponents } from "../hydration/ssr";
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

/**
 * The component whose markup this node is part of, typed.
 *
 * What `node._componentInstance` used to be. A component owns a RANGE of nodes now, so there is no
 * node to hang a back-reference off and the answer comes from the child record — see `componentAt`.
 * It THROWS rather than returning `undefined`, because a test asking this has already decided a
 * component is there and a `!` on the answer would only move the failure somewhere less useful.
 */
export function instanceOf<T>(node: Node | null | undefined): T {
  if (!node) throw new Error("[test] instanceOf was given no node");
  const found = componentAt(node);
  if (!found) throw new Error("[test] no component owns this node");
  return found as unknown as T;
}

/**
 * The components of a given class name under `root`, outermost first.
 *
 * What `[data-ramonda="Child"]` used to find. That attribute was a DEV marker on the host element,
 * and there is no host element — so the question moves to the record, which is where the answer
 * always really was. It also finds a component that renders NOTHING, which a selector never could.
 */
export function findAll<T>(root: Node, name: string): T[] {
  return componentsIn(root).filter((c) => c.constructor.name === name) as unknown as T[];
}

/**
 * A component's own record entry: the nodes it owns and the entries inside it.
 *
 * The internals, deliberately — a test that asks this is asking about the reconciler's bookkeeping
 * rather than about a page, and there is no public way to see a region because nothing outside the
 * diff has any business with one.
 */
export function regionOf(instance: object): ComponentRegion | undefined {
  return (instance as unknown as { [COMPONENT_RUNTIME]: { region?: ComponentRegion } })[COMPONENT_RUNTIME].region;
}

/** The one component of that name, and a failure when there is not exactly one. */
export function findOne<T>(root: Node, name: string): T {
  const found = findAll<T>(root, name);
  if (found.length !== 1) throw new Error(`[test] expected one <${name} />, found ${found.length}`);
  return found[0];
}

/**
 * What the SERVER would have served for a tree rendered on the client.
 *
 * `getDOM` renders on the client, and a client render writes no markers: a component's range is
 * known from the record there, so there is nothing to say in the markup. `markComponents` is the one
 * pass that adds what a hydrating client reads — the comment pair around each component's nodes,
 * with its state blob on the opening one.
 *
 * `state: false` writes the pair WITHOUT the blob, and it is not a convenience. A test about node
 * ADOPTION wants the server's nodes and the client's own initial state: a list's identity is the item
 * OBJECT, and a blob is a JSON round trip, so restoring it hands the client copies and every row
 * looks new. Those tests were written before any blob existed and they still ask the same question;
 * the ones about state transfer say so by leaving this alone.
 */
export function servedMarkup(container: HTMLElement, options?: { state?: boolean }): string {
  markComponents(container);
  if (options?.state === false) {
    const walk = (node: Node): void => {
      if (node.nodeType === 8) {
        const comment = node as Comment;
        const at = comment.data.indexOf(" ");
        if (comment.data.startsWith("c") && at !== -1) comment.data = comment.data.slice(0, at);
      }
      node.childNodes.forEach(walk);
    };
    walk(container);
  }
  return container.innerHTML;
}

export async function getDOM<T = any>(component: ComponentChild) {
  const user = userEvent.setup();
  const div = document.createElement("div");
  div.setAttribute("id", `app-${++containerSeq}`);
  document.body.appendChild(div);
  liveContainers.add(div);

  bootstrap(component, div);
  await Promise.resolve();

  /**
   * The outermost component in this container — the root the test just mounted.
   *
   * Asked of the container's own record rather than by walking the DOM for a back-reference: a
   * component owns a RANGE of nodes and has none of its own to park a pointer on. `componentAt`
   * answers "which component is this node in", so the container's first node is what to ask about,
   * and the root is the only component whose range covers it from here.
   */
  const findInstance = (node: Node): unknown => componentAt(node) ?? null;

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
