import { diagnose } from "./diagnostics";
import { displayName } from "../helpers/utils";
import { COMPONENT_RUNTIME } from "../core/runtime";
import { firstNodeOf } from "../core/DiffAndMerge";
import type { BaseComponent } from "../types/vdom";

/**
 * DEV-only rules about the update queue: who is allowed to schedule a render,
 * and how many times one drain may rebuild the same component before we call it
 * a loop rather than a cascade.
 */

/** Reports a state write that landed after the component was torn down. */
export function reportWriteAfterUnmount(component: BaseComponent): void {
  const name = displayName(component);
  diagnose("RMD008", name, `<${name} /> changed state after it was unmounted; the update is ignored.`);
}

/**
 * Reports a component that is about to re-render into a subtree no longer in the
 * document — mounted, alive, and orphaned.
 *
 * Unreachable from inside a pure Ramonda app: the diff unmounts on every path
 * that removes something, so a conditional render, a key change or a dropped
 * list item all tear down properly (measured: zero timer ticks after removal).
 * It is a BOUNDARY problem — a `ref` handed to a chart or modal library that
 * clears the node, an app embedded in a page whose host removes the mount point,
 * a hand-written `innerHTML`. Measured there: the timer kept firing and the
 * component kept rendering, with no diagnostic at all.
 *
 * Reported, never blocked, and that is deliberate: building a tree in a detached
 * container and inserting it later is legitimate, and refusing the update would
 * break it. This only says the thing nobody else says.
 *
 * Checked at DRAIN time rather than when the update is queued. `isInitialized`
 * is set before the host element is built, and the element is inserted by the
 * caller after that — so at queue time a perfectly healthy component can be
 * momentarily disconnected. A drain runs in a microtask, after the synchronous
 * commit, by which point anything still disconnected really is orphaned.
 */
export function reportOrphanedUpdate(component: BaseComponent): void {
  const componentRuntime = component[COMPONENT_RUNTIME];
  // On the server the container is never in a document, so this would fire on
  // every render.
  if (componentRuntime.env === "server") return;

  /**
   * The component's own first node, or the parent its block sits in.
   *
   * A component may own no node at all — a render that returned `null` — and that is not the fault
   * this reports: such a component is perfectly healthy as long as the parent it renders into is in
   * the document. So the parent is the question when there is nothing of its own to ask.
   */
  const region = componentRuntime.region;
  if (!region) return;

  /**
   * Its own first node, DERIVED from the record, and the parent when it owns none.
   *
   * A component may own no node at all — a render that returned `null` — and that is not the fault
   * this reports: such a component is healthy as long as the parent it renders into is in the
   * document. So the parent is the question when there is nothing of its own to ask.
   *
   * Derived rather than read off a cache, and that is the fix for a false report. The region used to
   * remember the nodes it held, and only the region that re-rendered refreshed its own memory — so a
   * component whose DESCENDANT had just swapped an element was accused of being orphaned while its
   * parent was in the document the whole time. Walking `entries` reaches the descendant's current
   * record instead, which names the node that is really there.
   *
   * A node that IS present and NOT connected stays a report, and deliberately: that is a library
   * clearing a subtree it was handed, which is the fault this exists for.
   */
  const node = firstNodeOf(region.entries) ?? region.parent;
  if (!node || node.isConnected) return;

  const name = displayName(component);
  diagnose("RMD016", name, `<${name} /> updated while the markup it renders into is not in the document.`);
}

/**
 * How many times one component may be rebuilt in a single drain before we stop
 * it. A cascade (a parent updating a child that syncs a prop back) settles in a
 * handful of passes; nothing legitimate needs fifty.
 */
const MAX_BUILDS_PER_DRAIN = 50;

/**
 * Rebuild counts, scoped to the drain in progress.
 *
 * The scope is the whole point. A runaway effect re-queues its component from
 * inside its own rebuild, so the loop spins inside one synchronous drain — that
 * is the case that freezes the tab. Counting across drains instead would just be
 * counting normal updates, and would report any component a user clicked fifty
 * times.
 */
const buildsThisDrain = new Map<BaseComponent, number>();
/** Components already reported in this drain, so one loop reports once. */
const loopedThisDrain = new Set<BaseComponent>();

export function startDrain(): void {
  // These hold components strongly, so they must not outlive the drain.
  buildsThisDrain.clear();
  loopedThisDrain.clear();
}

/**
 * Counts a rebuild and returns true once the component has clearly stopped
 * converging. Returning true means the caller must skip the build — that is
 * what breaks the loop: rendering is what writes the state that re-queues the
 * component, so not rendering ends the cascade and lets the queue drain.
 */
export function isRunawayUpdate(component: BaseComponent): boolean {
  const count = (buildsThisDrain.get(component) ?? 0) + 1;
  buildsThisDrain.set(component, count);

  if (count <= MAX_BUILDS_PER_DRAIN) return false;

  if (!loopedThisDrain.has(component)) {
    loopedThisDrain.add(component);
    const name = displayName(component);
    diagnose(
      "RMD009",
      name,
      `<${name} /> rebuilt ${MAX_BUILDS_PER_DRAIN} times in a single update without settling, so Ramonda stopped rendering it.`,
    );
  }
  return true;
}
