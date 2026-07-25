import type { HOOK_RUNTIME, HookRuntime, INTERNAL_HOOKS, Runtime, GLOBAL_RUNTIME } from "../core/runtime";

export type HookProps = Record<string, any> | undefined;

// The type parameter is a phantom (a variance marker only — callers write
// `BaseHook<T>`, nothing in the body reads it). Named `_`-prefixed so it is not
// mistaken for the `HookProps` type above and is understood as intentionally
// unbound.
export declare class BaseHook<_Options> {
  public [GLOBAL_RUNTIME]: Runtime;
  public [INTERNAL_HOOKS]?: (() => void)[];
  public [HOOK_RUNTIME]: HookRuntime;
}
