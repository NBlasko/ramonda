import { ownerRuntime } from "../core/renderEnv";
import { destroyed } from "./decorators";
import type { HookProps } from "../types/HookTypes";
import { Hook } from "./Hook";

/**
 * The half every hook the app ARMS has in common: when it may arm, and that it is undone once.
 *
 * `Timeout` and `Interval` were the first, and `Listen` is the second — a hook the app turns on at
 * some moment and off at another, which the framework still undoes when the owner goes. What they
 * share is not the arming, which is different every time; it is knowing **whether arming can be
 * made safe right now**, and that answer took two wrong attempts to get right.
 *
 * Extracted rather than copied when the second hook needed it. The reasoning below is forty lines of
 * measurement, and a second copy of it would have been the drift this codebase keeps paying for —
 * one of the two would have been fixed and the other left.
 */
export abstract class Armed<P extends HookProps> extends Hook<P> {
  /**
   * How to undo what is currently armed — a CLOSURE rather than a handle, because a timeout, an
   * interval and a listener are undone by three different calls, and one field that already knows
   * which cannot be asked the wrong question.
   */
  protected disarm: (() => void) | undefined;

  /**
   * Set by teardown, and the reason it exists is that neither of the two obvious answers is true when
   * it is asked.
   *
   * `ComponentRuntime.isDestroyed` is set AFTER the whole teardown pass — after effect cleanups and
   * after every `@destroyed` — so during teardown it still reads `false`. Measured: a `@destroyed`
   * calling `start(50)` got `true` back, left one live timer and fired it after unmount, with nothing
   * left to clear it. Not even `RMD006` reports that, because the timer has no lifecycle owner to be
   * attributed to by then.
   *
   * A latch of this hook's own is right whichever order the callbacks run in. If teardown reaches this
   * hook first, a later arming is refused. If it reaches the owner's `@destroyed` first, that arming
   * happens and this hook's teardown then undoes it. Reading the owner's flag can do neither.
   */
  private torn = false;

  /**
   * Whether arming can be made safe right now — one question, because all three answers to it mean
   * the same thing: do not start something nothing will undo.
   *
   * - **The owner is not built yet.** `isInitialized` is the framework's own "not ready" flag —
   *   `Task.ts` gates updates on it for the same reason — and it is what makes this correct rather than
   *   nearly correct. `ComponentRuntime.env` is `"client"` until `DiffAndMerge` assigns it, which
   *   happens AFTER the constructor returns, so an arming from a field initializer would read the wrong
   *   side. **Two attempts at this asked the side instead and both had a window:** the module flag is
   *   restored before `renderToString`'s first `await`, so a component built during `drainServerWork`
   *   answered "client" from the flag AND from the field. Measured, twice: a timer armed in the SSR
   *   process and fired there. Refusing until the component is BUILT closes every one of those windows
   *   at once, because `isInitialized` is set one line before `env` and no user code runs between them.
   * - **A server render**, once it is built.
   * - **Teardown has reached this hook.** See `torn`.
   *
   * There is no fourth case: a hook always has an owner, because `Runtime.owner` is required.
   */
  protected get armable(): boolean {
    if (this.torn) return false;
    const owner = ownerRuntime(this);
    return owner.isInitialized === true && owner.env !== "server";
  }

  /** Undoes what is armed. Safe to call when nothing is, and safe to call again. */
  stop(): void {
    this.disarm?.();
    this.disarm = undefined;
  }

  /**
   * Teardown, and it is NOT the same act as `stop()` — which is what an earlier version of this
   * claimed, with both on one member.
   *
   * Stopping is something an app does and then carries on from; teardown also has to make sure nothing
   * arms again, because a `@destroyed` running after this one can still reach for it. So it latches
   * as well as undoes. One member could not do both: `stop()` would then disable the hook for good.
   *
   * Not `private`, and that is TypeScript rather than intent: `noUnusedLocals` counts a private method
   * the decorator registers as unused, because a decorator's registration is not a call it can see.
   * `Portal.clear` carries a `@destroyed` the same way, for the same reason.
   */
  @destroyed
  teardown(): void {
    this.torn = true;
    this.stop();
  }
}
