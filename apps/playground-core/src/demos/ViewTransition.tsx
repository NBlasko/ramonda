import { destroyed, Hook, updated } from "@ramonda/core";

/**
 * Runs a state change inside a browser view transition, so an exit animates.
 *
 * ## The problem it solves
 *
 * A CSS transition needs the element to exist while it plays. Removing a row asks the diff to take the
 * node out, and a node that is gone cannot animate — so the exit never runs, however good the stylesheet
 * is. `document.startViewTransition` answers that by snapshotting the old frame first: what animates is
 * the SNAPSHOT, so nothing has to survive.
 *
 * ## Why `@updated` is the signal, and why guessing is the trap
 *
 * The browser waits for the callback's promise and then compares frames, so the promise has to resolve
 * once the DOM matches the new state. Ramonda batches a render on a microtask, so awaiting a fixed
 * number of microtask turns inside the callback happens to be enough — and "happens to be" is the whole
 * problem with it.
 *
 * `@updated` is the exact signal and it already exists. The drain is `drainBuilds()` then
 * `flushPostCommit()` then `flushUpdated()`, in a loop until nothing is left, so `@updated` runs after
 * the DOM has been written for that pass. Measured: a hook's `@updated` fires too, right after its
 * owner's, which is what lets this be self-contained rather than asking the owner for a line.
 *
 * ## The deadline is a net, not the mechanism
 *
 * If the change schedules no render — removing an id that is not there — `@updated` never fires and the
 * callback would never settle. The deadline below exists for that case only. It is not how the timing
 * works, which is the difference from counting microtasks: there, the timer WAS the mechanism.
 *
 * ## The one edge it cannot see
 *
 * `@updated` fires for EVERY commit, not for this change's commit. So a render already scheduled when
 * `run` is called settles the callback before this change is written, and the browser compares a frame too
 * early. Nothing here can tell the two apart — the framework's signal is "a commit happened", and asking
 * for "your commit happened" is what a core-side wrapper would be able to do.
 *
 * ## Where this belongs
 *
 * Not in `@ramonda/core`. It is six lines of app code around a browser API, and the framework has the
 * signal it needs already; a decorator in core would be new published surface for the easy half of the
 * job. The half that needs thought is `view-transition-name` in CSS, which no decorator can help with.
 * A hook is the shape a utility library would ship, so it is written as one here.
 */
export class ViewTransition extends Hook {
  private settle?: () => void;
  /**
   * The deadline's id, on a property so `@destroyed` can reach it.
   *
   * `@timeout` cannot express this — it fires relative to MOUNT, and this starts when `run` is called. A
   * raw timer is allowed on the framework's condition, which is exactly this: teardown has to be able to
   * clear it, or it outlives the component and settles a promise nobody is waiting for.
   */
  private deadlineId?: number;

  @destroyed stopDeadline() {
    this.clearDeadline();
  }

  private clearDeadline() {
    if (this.deadlineId !== undefined) {
      window.clearTimeout(this.deadlineId);
      this.deadlineId = undefined;
    }
  }

  /** Fires after the DOM has been written for this pass — see the note above. */
  @updated committed() {
    this.resolve();
  }

  private resolve() {
    const settle = this.settle;
    this.settle = undefined;
    this.clearDeadline();
    settle?.();
  }

  /**
   * Applies `change` inside a view transition, and resolves once the browser has taken over.
   *
   * Falls back to calling `change` directly where `startViewTransition` is missing, so a caller never
   * has to ask. `deadline` is the net described above.
   */
  run(change: () => void, deadline = 1000): Promise<void> {
    // No cast and no hand-written interface: TypeScript's own `lib.dom.d.ts` declares both
    // `startViewTransition` and `ViewTransition`. The runtime check is still needed, because a type
    // says nothing about which browsers shipped it.
    if (typeof document.startViewTransition !== "function") {
      change();
      return Promise.resolve();
    }

    const transition = document.startViewTransition(() => {
      // A run that starts while another is still waiting settles the earlier one first. Its `change`
      // already ran — the write is queued — so holding its callback open would only make the browser
      // wait out the deadline on a transition it has moved past. Measured before this: two clicks 120ms
      // apart both landed, and the first callback stayed pending for the full second.
      this.resolve();
      const settled = new Promise<void>((resolve) => {
        this.settle = resolve;
      });
      change();
      return Promise.race([
        settled,
        new Promise<void>((resolve) => {
          this.deadlineId = window.setTimeout(() => {
            this.deadlineId = undefined;
            this.settle = undefined;
            resolve();
          }, deadline);
        }),
      ]);
    });

    return transition.updateCallbackDone;
  }
}
