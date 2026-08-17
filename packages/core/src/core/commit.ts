import type { BaseComponent } from "../types/vdom";
import { COMPONENT_RUNTIME, GLOBAL_RUNTIME } from "./runtime";
import { errorHandler } from "./errorHandler";
import { addServerWork, isThenable } from "./serverWork";
import { reportFault } from "../debug/fault";

interface PendingMount {
  component: BaseComponent;
  /** May return a promise; on the server that is awaited before serializing. */
  cb: () => unknown;
}

/**
 * Work that must not run until the DOM this commit builds is actually in place:
 * @mounted callbacks, the first run of a component's effects (which is what
 * attaches @onElement / @onWindow listeners), and the DEV hydration lint.
 *
 * `buildComponent` used to call all three inline, at the end of building a
 * component — but the host element is inserted by the CALLER, after build
 * returns. So @mounted ran before its own element was in the document, which is
 * the one thing the name promises. Measured: on both a first mount and a
 * replacement, a `document.querySelector` inside @mounted found zero of its own
 * element, and on a replacement it found the OUTGOING instance's element.
 *
 * Two orderings are preserved exactly, because both are observable:
 *
 * - **FIFO**, and entries are queued in the order build reached them, so a child
 *   still mounts before its parent.
 * - **Per component: mounts, then lint, then effects** — the order they ran in
 *   before. Effects are deferred too rather than left inline; otherwise they
 *   would overtake @mounted, and an effect that reads a field @mounted sets would
 *   start seeing it unset.
 *
 * Only the timing moved. Nothing changed order relative to anything else.
 */
const pending: PendingMount[] = [];

/**
 * A flush already running. A @mounted callback can synchronously cause another
 * render — and therefore another flush — and re-entering would run later
 * entries before earlier ones finish. The outer loop picks up whatever the
 * nested work queued, so nothing is lost by declining here.
 */
let flushing = false;

/**
 * Bounds one flush. A @mounted that mounts a component whose @mounted does the same
 * would otherwise spin forever, and a frozen tab is the worst failure this
 * codebase has (see MAX_BUILDS_PER_DRAIN in Task.ts for the same reasoning).
 * Set far beyond any legitimate tree.
 */
const MAX_WORK_PER_FLUSH = 100_000;

export function queuePostCommit(component: BaseComponent, cb: () => unknown): void {
  pending.push({ component, cb });
}

/**
 * Components with `@updated` methods to run once this drain's DOM work is done.
 *
 * **A phase of its own, not an entry in `pending`, because the ORDER has to be the
 * opposite.** Mounts are FIFO, which puts children before parents on a first
 * commit — children are built inside their parent's diff, so their entries are
 * queued first. An UPDATE does not work that way: a child that already exists is
 * not rebuilt inside the parent's diff, it is *scheduled* (the diff writes its prop
 * signals), so its build — and anything it queues — comes AFTER the parent's.
 * Measured: `['parent', 'child']`, which is exactly wrong for the thing this
 * decorator exists for. A parent measuring its own subtree needs its children
 * updated first.
 *
 * So these are collected and run deepest-first. A `Set`, so a component that
 * rebuilt twice inside one drain runs its `@updated` once — the DOM only reflects
 * the last build, and running it per build would be reporting a state nobody can
 * see.
 */
const pendingUpdates = new Set<BaseComponent>();

/** A flush already running; same reasoning as `flushing` above. */
let flushingUpdates = false;

export function queueUpdated(component: BaseComponent): void {
  pendingUpdates.add(component);
}

/** Whether any `@updated` is still waiting. Part of what "settled" means. */
export function hasPendingUpdated(): boolean {
  return pendingUpdates.size > 0;
}

/**
 * Runs every pending `@updated`, deepest component first.
 *
 * **Client only**, like effects, and read off the component rather than the
 * module-level env (the same reason `runComponentEffects` does): this runs from a
 * drain that continues long after the render env flag has been put back. A server
 * render has no layout and no paint, so measuring there is meaningless work.
 *
 * Nothing is tracked while these run, and that is the decorator's reason to exist:
 * an effect re-runs when a dependency changes, and a dependency that is an array or
 * object rebuilt by a props callback "changes" on every render — so an effect used
 * for post-commit DOM work fires constantly and tears down its own cleanup each
 * time. `@updated` has no dependencies to get wrong.
 *
 * A destroyed component is skipped, the same guarantee `@mounted` has: between being
 * queued and being run, the component may have been torn down, and a lifecycle
 * callback must not fire after `@destroyed` has already cleaned up.
 *
 * A throw goes through `errorHandler` like a throwing `@mounted` — caught by an
 * `ErrorBoundary` above it, and rethrown if there is none. One decorator does not
 * get its own error semantics.
 */
export function flushUpdated(): void {
  if (flushingUpdates || pendingUpdates.size === 0) return;
  flushingUpdates = true;

  try {
    // Snapshotted and cleared first: a body may write state, which schedules
    // another build whose own `@updated` belongs to the NEXT pass, not this one.
    const components = Array.from(pendingUpdates);
    pendingUpdates.clear();

    // Deepest first. `sort` is stable, so components at the same depth keep the
    // order they were built in.
    components.sort((a, b) => b[COMPONENT_RUNTIME].depth - a[COMPONENT_RUNTIME].depth);

    for (const component of components) {
      const componentRuntime = component[COMPONENT_RUNTIME];
      if (componentRuntime.isDestroyed || componentRuntime.env === "server") continue;

      const updates = component[GLOBAL_RUNTIME].updates;
      try {
        for (let i = 0; i < updates.length; i++) updates[i]();
      } catch (e) {
        errorHandler(e, component);
      }
    }
  } finally {
    flushingUpdates = false;
  }
}

/** Drops a torn-down component's pending `@updated`, mirroring `discardPendingWork`. */
export function discardPendingUpdates(component: BaseComponent): void {
  pendingUpdates.delete(component);
}

/**
 * Whether anything is still waiting to be committed.
 *
 * For the synchronous drain a test harness needs: a @mounted can write state, and
 * that state schedules a render whose own @mounts land back here. "Settled" has
 * to mean both queues are empty, not just one. See `drainSync` in Task.ts.
 *
 * `pendingCommitWork` counts too: a `Head`/`Portal` recompute queued after the
 * last `flushPostCommit` — with no `@mounted` behind it — is post-commit work
 * nothing else will drain, so a drain that ignored it would report itself settled
 * and strand the head update until an unrelated later commit.
 */
export function hasPendingPostCommit(): boolean {
  return pending.length > 0 || pendingCommitWork.size > 0;
}

/**
 * Runs every pending entry, then anything they queued, until quiet.
 *
 * **A destroyed component's @mounted never runs.** This is the guarantee that
 * makes deferring safe: between queueing and flushing, the component may already
 * have been torn down — a list item removed in the same commit, a parent
 * replaced. Running its @mounted then would fire a lifecycle callback on a dead
 * component, and worse, AFTER its @destroyed had already cleaned up, so the
 * cleanup could not undo whatever the mount did.
 *
 * The check is inside the loop and per entry, not a filter taken up front,
 * because an earlier callback in this same flush can destroy a component whose
 * mount is still pending behind it.
 */
/**
 * Work that belongs to the COMMIT rather than to any one component: it runs once,
 * after every `@mounted` in this flush, however many components asked for it.
 *
 * `pending` above cannot express that. Every entry there is tied to a component, is
 * skipped if that component was destroyed, and runs once per entry — right for a
 * lifecycle callback, wrong for something the whole tree contributes to and that
 * must be computed from the finished result. `Head` is the case: each one publishes
 * during its own `@created`, and the head the document should have is a function of
 * all of them together, so recomputing per publication both does the work N times
 * and puts the document through states no commit ever meant to show.
 *
 * A `Set` of the work itself, so ten publications in one commit are one recompute.
 */
const pendingCommitWork = new Set<() => void>();

export function queueAfterCommit(work: () => void): void {
  pendingCommitWork.add(work);
}

/**
 * Runs the commit-level work now.
 *
 * Exported because not every teardown goes through a drain: unmounting a root is
 * called directly, and the work queued by the `@destroyed`s it runs would otherwise
 * sit until something else happened to commit.
 */
export function flushAfterCommit(): void {
  if (pendingCommitWork.size === 0) return;

  // Snapshotted and cleared first, so work that queues more belongs to the next
  // pass rather than extending this one.
  const work = Array.from(pendingCommitWork);
  pendingCommitWork.clear();

  for (const run of work) {
    try {
      run();
    } catch (e) {
      /**
       * Isolated the way a `@mounted` is, and for the same reason: one piece of
       * commit-level work must not stop the rest.
       *
       * It does not go to `errorHandler`, because there is no component to hand it
       * to — that is what makes this work commit-level rather than a lifecycle
       * callback. And it is not rethrown: this runs from the `finally` below, where
       * a throw would REPLACE whatever error the commit was already unwinding with,
       * and losing a component's real failure to a metadata one is the worse trade.
       */
      if (__DEV__) {
        console.error("[Ramonda] Post-commit work failed:", e);
      } else {
        /**
         * The one place the framework swallows an exception outright.
         *
         * Everything above explains why it is neither rethrown nor handed to `errorHandler`, and
         * none of that changes — but the consequence is that a production build has no way to say
         * this happened at all, and the work that failed is the work with no component to blame.
         * Nothing renders differently, nothing logs, and whoever wrote the callback has no way to
         * learn it never ran.
         *
         * So it goes to a collector if the app installed one. The error's own `message` is not
         * included: it is written by whatever threw, which may be the app or a library it uses, and
         * a record leaving the process is the wrong place to find that out for the first time.
         */
        reportFault("RMD053", "post-commit", "A post-commit callback threw, and the failure was swallowed.");
      }
    }
  }
}

export function flushPostCommit(): void {
  if (flushing) return;
  flushing = true;

  try {
    let ran = 0;
    while (pending.length > 0) {
      if (++ran > MAX_WORK_PER_FLUSH) {
        pending.length = 0;
        throw new Error(
          `[Ramonda] @mounted loop: mounting kept queueing more mounts ${MAX_WORK_PER_FLUSH} times without settling, ` +
            `so Ramonda stopped it rather than let the tab freeze. An @mounted that mounts a component which mounts another, ` +
            `without a condition that ends it, is the usual cause.`,
        );
      }

      const next = pending.shift()!;
      if (next.component[COMPONENT_RUNTIME].isDestroyed) continue;

      try {
        // A callback that returns a promise is async work the SERVER has to wait
        // for before serializing — `@mounted` is where an app fetches, and running
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
        // One component's @mounted must not stop the rest of the tree from
        // mounting — the same rule teardown follows.
        errorHandler(e, next.component);
      }
    }
  } finally {
    /**
     * After every mount, because that is what "the DOM this commit builds is in
     * place" means — and commit-level work is entitled to read the finished result.
     *
     * In the `finally` rather than after the loop: a `@mounted` with no
     * `ErrorBoundary` above it rethrows, and leaving this in the try meant one
     * throwing component deferred the whole commit's work to whenever something
     * next happened to commit. The page would go on with the head of the commit
     * before it, and nothing would say so.
     */
    flushAfterCommit();
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
