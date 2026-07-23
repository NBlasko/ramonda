import type { BaseHook, HookOptions } from "../types/HookTypes";
import { useCommon } from "../helpers/common";
import type { HookClassKind } from "../types/commonTypes";
import { createHookRuntime, HOOK_RUNTIME, type HookRuntime, type Runtime, GLOBAL_RUNTIME } from "../core/runtime";
import { State } from "../reactivity/State";
import { reportOptionWrite } from "../debug/renderPhase";
import { bindInstanceMethods } from "../helpers/bindMethods";

function createOptionsProxy(hook: Hook<HookOptions>) {
  return new Proxy(
    {},
    {
      get: (_, key: string) => {
        const hookRuntime = hook[HOOK_RUNTIME];
        let sig = hookRuntime?.optionsSignals.get(key);

        if (!sig) {
          const runtime = hook[GLOBAL_RUNTIME];
          // No assertion: `rawOptions` is typed as always present, because
          // createHookRuntime normalises a missing bag to `{}`.
          const value = hookRuntime.rawOptions[key];

          sig = new State(value, {
            listener: { id: runtime.id, onChange: runtime.reBuild },
          });
          hookRuntime.optionsSignals.set(key, sig);
        }

        return sig.get();
      },
      set: (_, key: string | symbol) => {
        // Options are read-only. Without this trap the write vanished without a
        // trace: it landed on the empty proxy target, the get trap kept serving
        // the signal, so reading the value back showed the OLD one and nothing
        // ever said the assignment had been dropped.
        //
        // Throws in every build, exactly like a write to props (RMD004) — one
        // rule for read-only inputs, not two. The DEV diagnostic below only
        // explains the throw; it is not what stops the write, so behaviour does
        // not differ between builds.
        if (__DEV__) {
          reportOptionWrite(hook, String(key));
        }
        throw new TypeError(
          `[RMD015] Cannot assign to \`options.${String(key)}\` in <${hook.constructor.name} /> — hook options are read-only and owned by the caller of this.use(). Copy it into @state, or take a callback option and ask the owner to change it.`,
        );
      },
    },
  );
}

export abstract class Hook<R extends HookOptions = undefined> implements BaseHook<R> {
  [GLOBAL_RUNTIME]: Runtime;
  [HOOK_RUNTIME]: HookRuntime;
  protected options: R;

  constructor(runtime: Runtime, initialOptions: R) {
    this[GLOBAL_RUNTIME] = runtime;
    this[HOOK_RUNTIME] = createHookRuntime(initialOptions);
    this.options = createOptionsProxy(this) as R;

    bindInstanceMethods(this, Hook.prototype);
  }

  protected use<T extends BaseHook<undefined>>(hook: HookClassKind<T, undefined>): T;
  protected use<T extends BaseHook<Q>, Q extends HookOptions, R extends (bag: this) => Q>(
    hook: HookClassKind<T, Q>,
    options: Q | R,
  ): T;
  protected use<T extends BaseHook<Q>, Q extends HookOptions, R extends (bag: this) => Q>(
    hook: HookClassKind<T, Q>,
    options?: Q | R,
  ): T {
    return useCommon(this, hook, options);
  }
}
