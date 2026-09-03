import { COMPONENT_RUNTIME, GLOBAL_RUNTIME } from "../core/runtime";
import type { BaseComponent } from "../types/vdom";
import { detach } from "./constants";
import { reportLeakedTimers } from "../debug/timerGuard";
import { discardPendingUpdates, discardPendingWork } from "../core/commit";

/**
 * Runs one piece of user cleanup, and does not let it take the rest down.
 *
 * Teardown is a sequence of things the app wrote — effect cleanups and
 * `@destroyed` bodies — and one throw used to abort all of it: the remaining
 * cleanups, `clearReactives`, the `isDestroyed` flag, and the caller's
 * `child.remove()`. Measured: a `@destroyed` that threw left the element on the
 * page, still rendered, with the component half alive.
 *
 * Reported rather than swallowed. A cleanup that throws is a defect worth
 * seeing, but not one worth leaking a subtree over.
 */
function runCleanup(what: string, component: BaseComponent<unknown>, cb: () => void) {
  try {
    cb();
  } catch (error) {
    /**
     * Not a diagnostic code: this is the app's own cleanup throwing, and the framework has no fix
     * to offer beyond the sentence already here. It is unconditional on purpose — a teardown that
     * failed halfway matters in production, where the listener or timer it did not clear is still
     * armed.
     */
    console.error(
      `[Ramonda] ${what} threw while <${component.constructor.name} /> was being destroyed. The rest of its cleanup still ran.`,
      error,
    );
  }
}

export function lifecycleCleanupManagement(component: BaseComponent<unknown>) {
  // Idempotent — an invariant, not a fix for a known bug. Measured: instrumented
  // to count teardowns per instance, the whole suite (374 core + 37 router) tears
  // every component down exactly once, with or without this line.
  //
  // Kept because there are now two ways in — the normal unmount, and the catch
  // around a failed build — and they are only kept apart by an accident of
  // reachability: a component that failed to build was never inserted, and the
  // other path walks the DOM. A future path reaching an inserted component twice
  // would run @destroyed twice and double-release whatever it releases.
  if (component[COMPONENT_RUNTIME].isDestroyed) return;

  const runtime = component[GLOBAL_RUNTIME];

  /**
   * No check for the array being there, and that is not an oversight.
   *
   * `effects` and `destroys` below are non-optional on `Runtime` and are assigned `[]` by
   * `createRuntime`, which is the only producer of one — verified: it is called from `Component`'s
   * constructor and nowhere else, a `Hook` is handed its OWNER's runtime, and `renderHook` mounts a
   * real component rather than building a runtime by hand. Neither assignment sits under
   * `if (__DEV__)`, so both builds have arrays.
   *
   * They were guarded with `if (effects)` / `if (destroys)`. Removing both changed nothing across
   * 1466 tests, which is what a branch nothing can enter looks like — two more paths to read and
   * none to trust. `reactivity/effect.ts` had the third copy and lost it too.
   */
  const effects = runtime.effects;
  {
    for (let i = effects.length - 1; i >= 0; i--) {
      const eff = effects[i];
      for (const dep of eff.deps) {
        dep[detach](eff.id);
      }
      const cleanup = eff.cleanup;
      if (cleanup) runCleanup("a subscription cleanup", component, cleanup);
    }
  }

  // One destroy pass cleans up after both @created and @mounted.
  // It runs while the reactive dependencies are still alive (before
  // clearReactives), so user code in @destroyed can still read reactive and
  // computed values.
  const destroys = runtime.destroys;
  {
    for (let i = destroys.length - 1; i >= 0; i--) {
      const entry = destroys[i];
      if (entry.env !== "server")
        runCleanup("a @destroyed", component, () => entry.cb(component[COMPONENT_RUNTIME].env));
    }
  }

  const clearReactives = runtime.clearReactives;

  for (const reactiveSignal of clearReactives) {
    runCleanup("unsubscribing a signal", component, reactiveSignal);
  }

  if (__DEV__) {
    // Last: effect cleanups (@interval/@timeout) and @destroyed have both had
    // their chance to clear. Whatever is still ticking was never cleaned up.
    reportLeakedTimers(component);
  }

  const componentRuntime = component[COMPONENT_RUNTIME];
  componentRuntime.inBuildQueue = false;
  // From here on the component is dead: @state signals still hold reBuild as a
  // listener (only @compute and context unsubscribe), so a late write — the
  // fetch that resolves after the user navigated away — would otherwise queue a
  // render for a detached subtree. addTaskToQueue refuses on this flag.
  componentRuntime.isDestroyed = true;

  // @mounted is deferred to a flush after the DOM work, so a component built and
  // torn down inside the same commit can still have one pending. The flush
  // checks this flag and skips it — @mounted must never run after @destroyed, or the
  // cleanup that already ran cannot undo it. Dropping the entry here also stops
  // the queue holding a dead component alive until the next flush.
  discardPendingWork(component);
  // Same reasoning for the post-commit `@updated` phase: the flush checks
  // `isDestroyed` anyway, but the queue should not hold a dead component until then.
  discardPendingUpdates(component);
}
