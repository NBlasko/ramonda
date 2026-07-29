import type { BaseComponent } from "../types/vdom";
import { diffAndMerge } from "./DiffAndMerge";
import { errorHandler } from "./errorHandler";
import { generateRenderOutput } from "../helpers/generateRenderOutput";
import { COMPONENT_RUNTIME, GLOBAL_RUNTIME, INTERNAL_HOOKS } from "./runtime";
import { runComponentEffects } from "../reactivity/effect";
import { runWatchProps } from "../helpers/watchProps";
import { notifyComponentUpdate } from "../debug/devtoolsBridge";
import {
  flushPostCommit,
  flushUpdated,
  hasPendingPostCommit,
  hasPendingUpdated,
  queuePostCommit,
  queueUpdated,
} from "./commit";
import { reportWriteAfterUnmount, reportOrphanedUpdate, isRunawayUpdate, startDrain } from "../debug/updateRules";

const taskQueue: BaseComponent<any>[] = [];

export function addTaskToQueue(component: BaseComponent<any>) {
  const componentRuntime = component[COMPONENT_RUNTIME];
  if (!componentRuntime.isInitialized) return;

  // A torn-down component must never be queued: its DOM is detached, so the
  // render would diff against nodes nobody can see and keep the whole subtree
  // alive. This is not only a dev check — the drop ships in production too.
  if (componentRuntime.isDestroyed) {
    if (__DEV__) reportWriteAfterUnmount(component);
    return;
  }

  // The server render this component belongs to has already been serialized, or
  // gave up. Its markup is produced; another render cannot reach it, and the
  // work that scheduled this one was abandoned with the request. Same reasoning
  // as `isDestroyed` above, and the drop likewise ships in production — a server
  // that keeps rendering abandoned trees leaks a request's worth of work each
  // time. See `serverWork.ts`.
  if (componentRuntime.serverWork?.done) return;

  // Hydration of this subtree has not happened yet: its children are server
  // nodes the diff knows nothing about, so rendering now would destroy them.
  // Resuming renders from current state, so nothing here is lost by waiting.
  if (componentRuntime.hydrationPending) return;

  if (componentRuntime.inBuildQueue) return;
  componentRuntime.inBuildQueue = true;

  const oldLength = insertTaskInQueue(component);

  if (oldLength) return;

  queueMicrotask(processTask);
}

/**
 * Drains the microtask-batched update queue until quiet (bounded). Used by the
 * server renderer to let mount-time (and cascading) state changes settle before
 * serializing. Does not await external async (data fetches) — the app must
 * orchestrate those itself.
 */
export async function flushTaskQueue(maxTicks = 50): Promise<void> {
  for (let ticks = 0; ticks < maxTicks; ticks++) {
    await Promise.resolve();
    if (taskQueue.length === 0) return;
  }
}

/**
 * Runs every pending update and every pending mount NOW, without waiting for the
 * microtask that normally batches them. The seam a test harness sits on — see
 * `src/testing.ts`.
 *
 * Updates are batched through `queueMicrotask`, so after a state write the DOM
 * is a microtask behind. That is right for an app and wrong for a test, where it
 * forced a guess: the old harness offered `settle: () => Promise.resolve()` and
 * tests called it once, twice, sometimes three times depending on how deep the
 * cascade went. One `await` too few and the assertion read stale DOM; the fix
 * was to add another and hope.
 *
 * "Settled" is both queues empty, not one. A render can queue @mounts, and an
 * @mount can write state that queues another render, so this alternates until
 * neither has anything left.
 *
 * Bounded for the same reason every loop here is bounded: an update cycle must
 * fail with a message rather than hang the run. The limit is on ROUNDS, not
 * builds — `processTask` has its own budget inside a single drain.
 */
export function drainSync(maxRounds = 50): void {
  for (let round = 0; round < maxRounds; round++) {
    if (taskQueue.length === 0 && !hasPendingPostCommit() && !hasPendingUpdated()) return;
    processTask();
  }

  throw new Error(
    `[Ramonda] flushSync gave up after ${maxRounds} rounds: rendering kept scheduling more work without settling. ` +
      `Usually an @effect or @mount writing state that its own render reads back. ` +
      `In a development build the cause is reported by name (RMD009).`,
  );
}

function insertTaskInQueue(component: BaseComponent<any>) {
  let index = 0;
  const oldLength = taskQueue.length;
  const componentRuntime = component[COMPONENT_RUNTIME];
  while (index < oldLength && taskQueue[index][COMPONENT_RUNTIME].depth >= componentRuntime.depth) {
    index++;
  }

  taskQueue.splice(index, 0, component);
  return oldLength;
}

function updateBuild(component: BaseComponent<any>) {
  if (component[INTERNAL_HOOKS]) {
    for (const update of component[INTERNAL_HOOKS]) {
      update();
    }
  }
  const componentRuntime = component[COMPONENT_RUNTIME];
  // Before inBuildQueue is cleared: that keeps a state write inside a watchProp
  // callback from scheduling a second pass, and lets its new value land in the
  // render below.
  runWatchProps(component);
  componentRuntime.inBuildQueue = false;
  const rendered = generateRenderOutput(component);

  diffAndMerge(rendered, component, componentRuntime.enhancedNode);

  // `@updated` — the post-commit door, and only on this path: the first commit
  // belongs to @mount, so neither the build path nor hydration queues these.
  //
  // Queued only when the component has any, so a component without `@updated`
  // pays one length check rather than an entry in the flush (measured at ~267 ns
  // per queued callback, which is not free when every component in a tree pays it).
  //
  // Collected, not queued into `pending`: `@updated` runs in a phase of its own,
  // AFTER the mounts and effects of this drain and deepest-component-first. See
  // `flushUpdated` — an update does not reach children through the parent's diff
  // the way a first mount does, so FIFO would run a parent before its children,
  // which is backwards for anything that measures a subtree.
  if (component[GLOBAL_RUNTIME].updates.length > 0) {
    queueUpdated(component);
  }

  // Queued, not inline — the third place this had to be fixed, after the build
  // path and hydration. `diffAndMerge` above can create components, and a new
  // one defers its own effects to the post-commit flush. Running this component's
  // effects here would put them BEFORE its freshly built children's, inverting
  // the rule that holds everywhere else: a component's effects run after its
  // children's.
  //
  // Measured on a docs demo that unmounts and remounts a subscriber: the parent
  // counted the store's listeners as 0 immediately after remounting, because its
  // own effect ran before the child had subscribed. `flushPostCommit` at the end
  // of the drain still runs everything within the same microtask, so nothing
  // moved except the order relative to children.
  queuePostCommit(component, () => runComponentEffects(component));
}

/**
 * The production stop, and the only job it has is to not freeze the machine.
 *
 * This drain is synchronous, so a component that re-queues itself from its own
 * rebuild spins it forever: the tab stops responding, and a frozen tab can take
 * the whole browser — sometimes the machine — with it. A thrown error is a bad
 * outcome; a frozen tab is a worse one, and it leaves no trace to debug.
 *
 * The DEV guard (RMD009) names the component and stops it at 50 rebuilds, but it
 * is stripped from production — so a loop that only appears with real data (an
 * effect that writes only when `items.length > 100`, say) would never have been
 * seen in development, and would freeze in front of a user.
 *
 * Deliberately blunt and deliberately huge: one integer for the whole drain, no
 * attribution, no allocation — an increment next to a render and a diff costs
 * nothing. The number has to sit beyond any legitimate drain: a real one is
 * bounded by how many components have pending state, which for a big app under a
 * global change can be tens of thousands. Attribution stays a DEV job.
 *
 * **Measured** on the two-effect ping-pong: the loop is stopped after **1.4s**,
 * against hanging until the OS killed it at 25s before this existed. A stall is
 * survivable; a frozen tab is not. Lower numbers stop it sooner but move toward
 * false-firing on a legitimate drain, and a wrong throw in production is worse
 * than 1.4s of jank.
 *
 * The default test run cannot cover this: `__DEV__` compiles to
 * `process.env.NODE_ENV !== "production"` and vite bakes NODE_ENV in at
 * transform, so flipping it inside a test does nothing (it silently keeps
 * testing the DEV path). It has to be a whole process:
 *
 *   NODE_ENV=production npx vitest run <file>
 */
const MAX_BUILDS_PER_DRAIN = 100_000;

/** Leaves no component stuck with inBuildQueue set, which would silently block every future update to it. */
function abandonQueue(): void {
  for (const queued of taskQueue) {
    queued[COMPONENT_RUNTIME].inBuildQueue = false;
  }
  taskQueue.length = 0;
}

function processTask() {
  if (__DEV__) startDrain();

  let builds = 0;
  // One drain covers builds AND the post-commit work they queue, alternating
  // until neither has anything left.
  //
  // It has to, for two reasons. Effects are queued rather than run inline (see
  // updateBuild), so an effect that writes state schedules another build — and
  // if that landed in a LATER drain, the whole loop-detection story would come
  // apart: `startDrain` resets RMD009's per-component counter, and
  // MAX_BUILDS_PER_DRAIN counts within one drain. A ping-pong between two
  // effects would then reset both counters on every bounce and never be caught,
  // which is exactly what happened when effects first moved to the queue — the
  // RMD009 test was the only thing that noticed.
  do {
    drainBuilds();
    flushPostCommit();
    // After the mounts and effects this commit queued, and in its own phase — see
    // `flushUpdated` for why the order has to be the opposite of theirs. A body
    // that writes state schedules another build, which the `while` picks up.
    flushUpdated();
  } while (taskQueue.length > 0 || hasPendingUpdated());

  if (__DEV__) {
    // Cheap, gated ping — no-op unless the devtools is actively watching.
    notifyComponentUpdate();
  }

  function drainBuilds() {
    let component = taskQueue.pop();
    while (component) {
      if (component[COMPONENT_RUNTIME].inBuildQueue) {
        // A component that keeps re-queueing itself from its own rebuild spins
        // this loop synchronously and freezes the tab, so the diagnostic has to
        // stop it rather than just describe it. Skipping the build is what breaks
        // the cycle: the render is what writes the state that re-queues it.
        // Before the rebuild, so the report names a component that is about to
        // render into a subtree nobody can see.
        if (__DEV__) reportOrphanedUpdate(component);

        if (__DEV__ && isRunawayUpdate(component)) {
          component[COMPONENT_RUNTIME].inBuildQueue = false;
          component = taskQueue.pop();
          continue;
        }

        if (++builds > MAX_BUILDS_PER_DRAIN) {
          const name = component.constructor.name;
          abandonQueue();
          throw new Error(
            `[Ramonda] Update loop: one update rebuilt components ${MAX_BUILDS_PER_DRAIN} times without settling, ` +
              `so Ramonda stopped it rather than let the tab freeze. The last component in the loop was <${name} />, ` +
              `though the cause may be any component it updates. Rendering wrote state that scheduled another render, ` +
              `forever — usually two @effect methods writing what the other reads, or a write inside render(). ` +
              `Run this path in a development build: it reports the exact component (RMD009).`,
          );
        }

        try {
          updateBuild(component);
        } catch (e) {
          errorHandler(e, component);
        }
      }

      component = taskQueue.pop();
    }
  }
}
