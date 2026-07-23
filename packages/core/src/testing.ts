/**
 * The seam a test harness sits on — `@ramonda/core/testing`.
 *
 * Not part of the app-facing API and deliberately reached by a different
 * specifier. `index.ts` is guarded by two tests (`PublicSurface`,
 * `InternalFolders`) whose whole job is to keep `core/`, `helpers/` and
 * `reactivity/` out of what an application can import — and a harness genuinely
 * needs three things from in there. Widening `index.ts` for it would have handed
 * every app the same access, permanently, to make a test utility possible.
 *
 * So it is a second door: narrow, documented, and pinned by its own tripwire
 * (`__tests__/TestingSeam.test.ts`). The same shape as `react-dom/test-utils` —
 * available to whoever needs it, not in the way of anyone who does not.
 *
 * **Three things, and no more.** Everything else `@ramonda/testing-library`
 * needs — `bootstrap`, `unmount`, `h`, `hydrateRoot`, `renderToString` — is
 * already public, and should stay the way a harness reaches it. If something new
 * belongs here, the test in `TestingSeam.test.ts` has to be updated on purpose,
 * which is the point.
 */

import { drainSync } from "./core/Task";
import { diffAndMerge } from "./core/DiffAndMerge";
import type { BaseComponent, ComponentChild, VNode } from "./types/vdom";

/**
 * Runs every pending update and every pending mount NOW.
 *
 * Ramonda batches updates through a microtask, so after a state write the DOM is
 * one tick behind. A test that asserts straight afterwards reads the old DOM.
 * This closes that gap synchronously, and keeps going until nothing is left in
 * either the update queue or the post-commit queue.
 */
export function flushSync(): void {
  drainSync();
}

/**
 * Re-renders `vnode` into a container that was already rendered into, diffing
 * against what is there instead of replacing it.
 *
 * This is what makes a `rerender(<Card title="b" />)` mean the same thing it
 * means anywhere else: the component instance survives, its `@state` survives,
 * `@create` does not run again, and `@watchProp` fires. Measured on a `<Card>`
 * with `hits = 7`: `a:0` → `b:7`, same DOM node, same instance, one `@create`.
 *
 * `bootstrap` cannot do this — it appends, so calling it twice gives two trees.
 *
 * The update itself is queued, not immediate: the props signals change, which
 * schedules a render like any other change. Call `flushSync` after it.
 */
export function rerenderRoot(vnode: ComponentChild, container: HTMLElement): void {
  const existing = container.firstChild;
  if (existing === null) {
    throw new Error(
      "[Ramonda] rerenderRoot was given an empty container. Render into it first — " +
        "there is nothing to diff against.",
    );
  }

  diffAndMerge(vnode as VNode, undefined, existing as never);
}

/**
 * The component instance a DOM node belongs to, if it is a component's host.
 *
 * The back-reference is written by the diff and is what the devtools inspector
 * and the SSR serializer already read. Exposed here so a harness can hand a test
 * the instance without reaching into the node's internals itself.
 */
export function getComponentInstance(node: Node | null | undefined): BaseComponent<never> | undefined {
  if (!node) return undefined;
  return (node as { _componentInstance?: BaseComponent<never> })._componentInstance;
}
