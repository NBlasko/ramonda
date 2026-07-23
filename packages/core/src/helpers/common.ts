import { HOOK_RUNTIME, INTERNAL_HOOKS, GLOBAL_RUNTIME, CHILD_HOOKS } from "../core/runtime";
import type { HookClassKind } from "../types/commonTypes";
import type { BaseHook, HookOptions } from "../types/HookTypes";
import type { BaseComponent } from "../types/vdom";

export function useCommon<T extends BaseHook<any>, P>(
  that: BaseComponent<P> | BaseHook<HookOptions>,
  hook: HookClassKind<T, any>,
  hookOptions?: any,
): T {
  let internalHooks = that[INTERNAL_HOOKS];

  if (!internalHooks) {
    internalHooks = [];
    Object.defineProperty(that, INTERNAL_HOOKS, {
      value: internalHooks,
      configurable: false,
      enumerable: false,
      writable: true,
    });
  }

  const runtime = that[GLOBAL_RUNTIME];

  const initialOptions = typeof hookOptions === "function" ? hookOptions(that) : (hookOptions ?? {});
  const hookInstance = new hook(runtime, initialOptions);
  const hookRuntime = hookInstance[HOOK_RUNTIME];

  // Track child hook instances in use() order — deterministic tree for hydration.
  const owner = that as { [CHILD_HOOKS]?: BaseHook<any>[] };
  let childHooks = owner[CHILD_HOOKS];
  if (!childHooks) {
    childHooks = [];
    Object.defineProperty(that, CHILD_HOOKS, {
      value: childHooks,
      enumerable: false,
      configurable: false,
      writable: true,
    });
  }
  childHooks.push(hookInstance);

  const updateFn = () => {
    const nextOptions = typeof hookOptions === "function" ? hookOptions(that) : (hookOptions ?? {});
    const prevOptions = hookRuntime.rawOptions;
    hookRuntime.rawOptions = nextOptions;
    const sigs = hookRuntime.optionsSignals;

    if (prevOptions) {
      // An update: both the old and the new options exist.

      // 1. Walk the new options and wake the signals whose value moved.
      for (const key in nextOptions) {
        const newVal = nextOptions[key];
        if (newVal !== prevOptions[key]) {
          sigs.get(key)?.set(newVal);
        }
      }

      // 2. Walk the old options for keys the new one dropped. Without this a
      //    removed key would keep its last value forever — nothing else ever
      //    visits it again.
      for (const key in prevOptions) {
        if (!(key in nextOptions)) {
          sigs.get(key)?.set(undefined);
        }
      }
    } else {
      // First render: nothing to compare against, so just seed every signal.
      for (const key in nextOptions) {
        sigs.get(key)?.set(nextOptions[key]);
      }
    }

    // Indexed loop over the children — the fastest form, and this runs on
    // every hook update.
    const children = hookInstance[INTERNAL_HOOKS];
    if (children !== undefined) {
      const len = children.length;
      for (let i = 0; i < len; i++) {
        children[i]();
      }
    }
  };

  internalHooks.push(updateFn);

  return hookInstance;
}
