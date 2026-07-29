import { HOOK_RUNTIME, INTERNAL_HOOKS, GLOBAL_RUNTIME, CHILD_HOOKS } from "../core/runtime";
import { STABLE, STABLE_PROPS } from "./constants";
import { valueEqual } from "./valueEqual";
import { checkPropsStability } from "../debug/propsStability";
import { isStrictRender } from "../debug/renderStability";
import type { HookClassKind } from "../types/commonTypes";
import type { BaseHook, HookProps } from "../types/HookTypes";
import type { BaseComponent } from "../types/vdom";
import { propsPhase } from "../debug/purityGuard";

/**
 * Calls the props callback, and in a development build holds it to the same two standards
 * `render()` is held to — the phase is marked, so randomness read while building a bag is
 * attributed to the bag (RMD021), and under a strict render it is called twice and the two
 * bags are compared (RMD022).
 *
 * The two checks are not redundant. The marker watches the CALL, so it catches a value
 * that happens to come out the same twice; the comparison watches the VALUE, so it catches
 * a rebuilt array or closure, which no patched global can see.
 */
function buildProps(that: object, hookName: string, hookProps: unknown, declared: readonly string[] | undefined): any {
  if (typeof hookProps !== "function") return hookProps ?? {};

  const build = hookProps as (bag: unknown) => any;

  // `if (__DEV__) { … }` around the whole thing, not `if (!__DEV__) return build(that)`
  // with the checks after it. The two read the same but bundle differently: an early
  // return leaves the rest of the body reachable as far as esbuild's dead-code pass is
  // concerned, so `checkPropsStability` stayed referenced in a production build and
  // dragged `diagnose` — and with it every diagnostic's title and fix text, all 21 of
  // them — into the bundle. Caught by apps/docs' production build test.
  if (__DEV__) {
    const label = `${that.constructor.name} → ${hookName}`;
    const previous = propsPhase.label;
    propsPhase.label = label;
    try {
      const bag = build(that);

      // A second call, compared against the first — the same check `render()` gets, on
      // the other place the framework asks the app for a value. See
      // debug/propsStability.ts for why twice in one tick, and why on every render.
      if (isStrictRender()) checkPropsStability(label, bag, build(that), declared);

      return bag;
    } finally {
      propsPhase.label = previous;
    }
  }

  return build(that);
}

/**
 * Replaces every `stable()` marker with a value whose identity survives while its
 * contents do — the previous render's value for that key, when the two are equal.
 *
 * Runs in every build, not only development: this is the behaviour `stable()` promises,
 * and the diagnostic that recommends it is separate. Top-level values only, and the loop
 * is skipped entirely for a bag that holds no markers, which is the common case — one
 * `in` check per key and nothing else.
 */
function resolveStable(next: any, prev: Record<string, any> | undefined, declared: readonly string[] | undefined): any {
  let resolved: Record<string, any> | undefined;

  for (const key in next) {
    const value = next[key];
    const wrapped = value !== null && typeof value === "object" && STABLE in value;
    // A hook that declared this prop gets the same treatment without the call site asking
    // for it — that is the whole point of the declaration.
    if (!wrapped && !declared?.includes(key)) continue;

    const inner = wrapped ? value[STABLE] : value;

    // A declaration cannot make a function comparable — two closures with the same body
    // are not equal by any comparison that is safe to make — so a function prop is left
    // exactly as it came, and RMD022 still reports it. Silently accepting it would be the
    // worst of both: unstable AND unreported.
    if (typeof inner === "function") continue;

    const target = resolved ?? (resolved = { ...next });
    const before = prev?.[key];
    // The previous value is already unwrapped, so an equal one is handed straight back
    // and every signal that reads this prop stays asleep.
    target[key] = before !== undefined && valueEqual(inner, before, STABLE_DEPTH) ? before : inner;
  }

  return resolved ?? next;
}

/**
 * Deeper than the diagnostic's default, because `stable()` is opt-in: the app asked for
 * this value to be compared, and the payload is its own — a query key, a filter object.
 * Past the bound a fresh reference is handed back, which is correct but not optimal.
 */
const STABLE_DEPTH = 5;

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

  // Read once per use() site rather than per render: `@StableProps` writes a
  // non-configurable symbol on the class, so it cannot change afterwards.
  const declaredStable = (hook as unknown as { [STABLE_PROPS]?: readonly string[] })[STABLE_PROPS];

  const initialProps = resolveStable(buildProps(that, hook.name, hookProps, declaredStable), undefined, declaredStable);

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
    const prevProps = hookRuntime.rawProps;
    const nextProps = resolveStable(buildProps(that, hook.name, hookProps, declaredStable), prevProps, declaredStable);
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
