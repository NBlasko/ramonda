import { GLOBAL_RUNTIME, COMPONENT_RUNTIME } from "../core/runtime";
import { attach, detach } from "../helpers/constants";
import type { BaseComponent } from "../types/vdom";
import type { State } from "./State";
import { reactivityScope } from "./tracker";

export interface Effect {
  id: number;
  /**
   * `unknown`, because that is what the runner actually requires: it guards with
   * `typeof res === "function"` below and ignores anything else. Declared as
   * `undefined | (() => void)` it claimed more than the code asks, and the gap was bridged by an
   * `any` in `attachEffect` — a lifecycle method is free to return whatever it likes.
   */
  effect: () => unknown;
  deps: Set<State<unknown>>;
  shouldRebuild: boolean;
  cleanup: (() => void) | null;
  alwaysRebuild: boolean;
  mutated: Set<State<unknown>>;
}

/**
 * A function came back from an effect, so it is treated as the cleanup.
 *
 * `typeof res === "function"` narrows `unknown` to `Function`, which TypeScript will not call — so the
 * one assumption the runtime makes is named here instead of hidden in an `any` on `Effect.effect`: a
 * function returned from a lifecycle is called with no arguments when the effect is torn down.
 */
function isCleanup(value: unknown): value is () => void {
  return typeof value === "function";
}

export function runComponentEffects(component: BaseComponent<unknown>) {
  // Effects are client-only — never run them during a server render. Read off
  // the component, not the module-level env: this also runs from the task queue,
  // long after the server render has yielded and reset that.
  if (component[COMPONENT_RUNTIME].env === "server") return;

  // No check for the array: `effects` is non-optional on `Runtime` and `createRuntime` — the only
  // producer of one — assigns `[]` outside `if (__DEV__)`. See `helpers/lifecycleMenagement.ts`.
  const effects = component[GLOBAL_RUNTIME].effects;

  const dirtyEffects: Effect[] = [];
  for (const eff of effects) {
    if (eff.shouldRebuild) {
      eff.cleanup?.();
      eff.cleanup = null;
      dirtyEffects.push(eff);
    }
  }

  for (const eff of dirtyEffects) {
    for (const dep of eff.deps) {
      dep[detach](eff.id);
    }

    // The tracking scope: signals read from here on are recorded as this
    // effect's dependencies.
    reactivityScope.currentEffect = eff;
    eff.deps.clear();
    eff.mutated.clear();

    try {
      const res = eff.effect();

      if (isCleanup(res)) {
        eff.cleanup = res;
      }
    } finally {
      /**
       * A `finally`, and that is the whole point of the block.
       *
       * `currentEffect` is a module-global, so leaving it set does not fail
       * here — it fails everywhere else. Every `State.get()` in the entire app
       * would then record itself onto a dead effect's `deps`: an unbounded set
       * holding a strong reference to every signal read from that moment on,
       * and `State.set` marking `mutated` on it. Measured after one throwing
       * `connect`: the scope stayed set, and two unrelated reads landed in it
       * immediately. Nothing reset it until the next effect flush — and if the
       * component that threw was the only one with effects, nothing ever did.
       *
       * The bookkeeping below is in here for the same reason. An effect that
       * threw part-way still read real signals before it did, and those are
       * real dependencies: attaching them is what lets it run again when they
       * change. Resetting `shouldRebuild` is what stops it retrying on every
       * single commit forever.
       */
      reactivityScope.currentEffect = null;

      for (const mutatedDep of eff.mutated) {
        mutatedDep[detach](eff.id);
        eff.deps.delete(mutatedDep);
      }

      for (const dep of eff.deps) {
        dep[attach]({
          id: eff.id,
          onChange: () => {
            eff.shouldRebuild = true;
          },
        });
      }

      eff.shouldRebuild = eff.alwaysRebuild;
    }
  }
}
