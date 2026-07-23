import type { BaseComponent } from "../types/vdom";
import { COMPONENT_RUNTIME } from "./runtime";
import { errorHandler } from "./errorHandler";
import { addServerWork, isThenable } from "./serverWork";

interface PendingMount {
  component: BaseComponent;
  /** May return a promise; on the server that is awaited before serializing. */
  cb: () => unknown;
}

/**
 * Work that must not run until the DOM this commit builds is actually in place:
 * @mount callbacks, the first run of a component's effects (which is what
 * attaches @onElement / @onWindow listeners), and the DEV hydration lint.
 *
 * `buildComponent` used to call all three inline, at the end of building a
 * component — but the host element is inserted by the CALLER, after build
 * returns. So @mount ran before its own element was in the document, which is
 * the one thing the name promises. Measured: on both a first mount and a
 * replacement, a `document.querySelector` inside @mount found zero of its own
 * element, and on a replacement it found the OUTGOING instance's element.
 *
 * Two orderings are preserved exactly, because both are observable:
 *
 * - **FIFO**, and entries are queued in the order build reached them, so a child
 *   still mounts before its parent.
 * - **Per component: mounts, then lint, then effects** — the order they ran in
 *   before. Effects are deferred too rather than left inline; otherwise they
 *   would overtake @mount, and an @effect that reads a field @mount sets would
 *   start seeing it unset.
 *
 * Only the timing moved. Nothing changed order relative to anything else.
 */
const pending: PendingMount[] = [];

/**
 * A flush already running. A @mount callback can synchronously cause another
 * render — and therefore another flush — and re-entering would run later
 * entries before earlier ones finish. The outer loop picks up whatever the
 * nested work queued, so nothing is lost by declining here.
 */
let flushing = false;

/**
 * Bounds one flush. A @mount that mounts a component whose @mount does the same
 * would otherwise spin forever, and a frozen tab is the worst failure this
 * codebase has (see MAX_BUILDS_PER_DRAIN in Task.ts for the same reasoning).
 * Set far beyond any legitimate tree.
 */
const MAX_WORK_PER_FLUSH = 100_000;

export function queuePostCommit(component: BaseComponent, cb: () => unknown): void {
  pending.push({ component, cb });
}

/**
 * Whether anything is still waiting to be committed.
 *
 * For the synchronous drain a test harness needs: a @mount can write state, and
 * that state schedules a render whose own @mounts land back here. "Settled" has
 * to mean both queues are empty, not just one. See `drainSync` in Task.ts.
 */
export function hasPendingPostCommit(): boolean {
  return pending.length > 0;
}

/**
 * Runs every pending entry, then anything they queued, until quiet.
 *
 * **A destroyed component's @mount never runs.** This is the guarantee that
 * makes deferring safe: between queueing and flushing, the component may already
 * have been torn down — a list item removed in the same commit, a parent
 * replaced. Running its @mount then would fire a lifecycle callback on a dead
 * component, and worse, AFTER its @destroy had already cleaned up, so the
 * cleanup could not undo whatever the mount did.
 *
 * The check is inside the loop and per entry, not a filter taken up front,
 * because an earlier callback in this same flush can destroy a component whose
 * mount is still pending behind it.
 */
export function flushPostCommit(): void {
  if (flushing) return;
  flushing = true;

  try {
    let ran = 0;
    while (pending.length > 0) {
      if (++ran > MAX_WORK_PER_FLUSH) {
        pending.length = 0;
        throw new Error(
          `[Ramonda] @mount loop: mounting kept queueing more mounts ${MAX_WORK_PER_FLUSH} times without settling, ` +
            `so Ramonda stopped it rather than let the tab freeze. An @mount that mounts a component which mounts another, ` +
            `without a condition that ends it, is the usual cause.`,
        );
      }

      const next = pending.shift()!;
      if (next.component[COMPONENT_RUNTIME].isDestroyed) continue;

      try {
        // A callback that returns a promise is async work the SERVER has to wait
        // for before serializing — `@mount` is where an app fetches, and running
        // it on the server is the whole reason the data lands in the HTML.
        //
        // Registered rather than awaited: this flush is synchronous and must
        // stay so, because a page's mounts cannot be reordered around a network
        // round trip. `renderToString` drains the collector afterwards.
        //
        // Nothing changes on the client. Effect callbacks return cleanups, not
        // promises, and a client component has no collector to register on.
        const result = next.cb();
        if (isThenable(result)) {
          addServerWork(next.component[COMPONENT_RUNTIME].serverWork, result);
        }
      } catch (e) {
        // One component's @mount must not stop the rest of the tree from
        // mounting — the same rule teardown follows.
        errorHandler(e, next.component);
      }
    }
  } finally {
    flushing = false;
  }
}

/**
 * Drops pending work for a component being torn down.
 *
 * The `isDestroyed` check in the flush already covers correctness; this keeps
 * the queue from holding a reference to a dead component and its closure until
 * the next flush.
 */
export function discardPendingWork(component: BaseComponent): void {
  for (let i = pending.length - 1; i >= 0; i--) {
    if (pending[i].component === component) pending.splice(i, 1);
  }
}
