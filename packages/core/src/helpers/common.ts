import { HOOK_RUNTIME, INTERNAL_HOOKS, GLOBAL_RUNTIME, CHILD_HOOKS } from "../core/runtime";
import type { HookClassKind } from "../types/commonTypes";
import type { BaseHook, HookProps } from "../types/HookTypes";
import type { BaseComponent } from "../types/vdom";
import { propsPhase } from "../debug/purityGuard";

/**
 * Runs the props callback with the phase marked, so randomness inside a bag is reported
 * against the bag (RMD021) rather than against nothing.
 *
 * Marking beats double-calling: a callback may do more than build an object, and running
 * it twice would do that twice. Watching the call catches the same mistake without it.
 */
function buildProps(that: object, hookName: string, hookProps: unknown): any {
  if (typeof hookProps !== "function") return hookProps ?? {};

  if (!__DEV__) return (hookProps as (bag: unknown) => unknown)(that);

  const previous = propsPhase.label;
  propsPhase.label = `${that.constructor.name} → ${hookName}`;
  try {
    return (hookProps as (bag: unknown) => unknown)(that);
  } finally {
    propsPhase.label = previous;
  }
}

export function useCommon<T extends BaseHook<any>, P>(
  that: BaseComponent<P> | BaseHook<HookProps>,
  hook: HookClassKind<T, any>,
  hookProps?: any,
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

  const initialProps = buildProps(that, hook.name, hookProps);

  const hookInstance = new hook(runtime, initialProps);
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
    const nextProps = buildProps(that, hook.name, hookProps);
    const prevProps = hookRuntime.rawProps;
    hookRuntime.rawProps = nextProps;
    const sigs = hookRuntime.propsSignals;

    if (prevProps) {
      // An update: both the old and the new props exist.

      // 1. Walk the new props and wake the signals whose value moved.
      for (const key in nextProps) {
        const newVal = nextProps[key];
        if (newVal !== prevProps[key]) {
          sigs.get(key)?.set(newVal);
        }
      }

      // 2. Walk the old props for keys the new one dropped. Without this a
      //    removed key would keep its last value forever — nothing else ever
      //    visits it again.
      for (const key in prevProps) {
        if (!(key in nextProps)) {
          sigs.get(key)?.set(undefined);
        }
      }
    } else {
      // First render: nothing to compare against, so just seed every signal.
      for (const key in nextProps) {
        sigs.get(key)?.set(nextProps[key]);
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
