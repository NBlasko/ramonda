import type { Context } from "../types/commonTypes";
import type { Effect } from "../reactivity/effect";
import type { BaseComponent, MaybeEnhancedNode, LifecycleEntry, WatchPropEntry } from "../types/vdom";
import { createId } from "../helpers/createId";
import { addTaskToQueue } from "./Task";
import type { State } from "../reactivity/State";
import type { HookProps } from "../types/HookTypes";
import type { RenderEnv } from "./renderEnv";
import type { ServerWork } from "./serverWork";

type ClearReactives = (() => void)[];

export interface Runtime {
  id: number;
  context: Context;
  mounts: LifecycleEntry[];
  creates: LifecycleEntry[];
  destroys: LifecycleEntry[];
  watchProps: WatchPropEntry[];
  /**
   * `@deferHydration` methods, bound. Called only while hydrating; each may
   * return a promise, and hydration waits for all of them.
   */
  deferHydrations: (() => unknown)[];
  /**
   * DEV only. The component this runtime belongs to, so a diagnostic can name it.
   *
   * A hook shares its owner's runtime, so this is always the COMPONENT — which is the
   * useful answer: a missing provider is fixed by mounting one above that component, not
   * above the hook that happened to read it.
   */
  holder?: object;
  /**
   * The component this runtime belongs to — always the COMPONENT, never a hook,
   * because a hook shares its owner's runtime rather than making its own (this is
   * only ever set from `Component`'s constructor). It is the same object
   * `reBuild` already closes over, so holding it here adds no retention.
   *
   * A hook needs it to reach its owner as the `placeholderComponent` a reconcile
   * runs under — for the context, render side and depth a portaled subtree
   * inherits. `holder` cannot serve this: it is DEV-only.
   */
  owner?: BaseComponent;
  effects: Effect[];
  /**
   * `@updated` methods, bound. Run after the DOM of an UPDATE is committed —
   * never for the first commit, which is `@mounted`'s.
   *
   * Plain thunks rather than `Effect`s, and that is the whole point of the
   * decorator: nothing here is tracked, so there are no dependencies to record,
   * nothing to attach or detach, and no cleanup to run. See `runComponentUpdates`.
   */
  updates: (() => void)[];
  clearReactives: ClearReactives;
  hooksOptions: (() => unknown)[];
  reBuild(): void;
}

export interface ComponentRuntime {
  depth: number;
  /**
   * The props as they arrived, keyed — not `RenderableProps<P>`.
   *
   * Every reader treats it as a bag and nothing reads a declared field off it: the props proxy looks up
   * one key at a time, the diff walks `for (const key in …)` comparing old against new, and
   * `debug/inspector.ts` already declared it as `Record<string, unknown>`. Typed as the props shape it
   * needed an `any` to be indexed at all, plus two casts in `Component.ts` saying what it really was.
   * Symbols are in the key type because the proxy forwards those too.
   */
  rawProps: Record<string | symbol, unknown>;
  /**
   * The method `@catchError` declared, if any — the seam `errorHandler` walks the
   * parent chain looking for. Held per instance because the handler is bound to
   * one, and dispatched by name so a subclass override wins.
   */
  catchError?: (e: unknown) => unknown;
  propsSignals: Map<string, State<unknown>>;
  parent?: BaseComponent;
  inBuildQueue?: boolean;
  isInitialized?: boolean;
  /**
   * Set while this component has adopted the server's DOM but has not hydrated
   * its own subtree yet — see `deferHydration` on Component.
   *
   * It blocks updates for the same reason `isDestroyed` does: between deferring
   * and resuming, the children are server nodes with no vnode association, so a
   * render would diff against markup nothing owns and clobber the very subtree
   * the deferral exists to protect. The update is delayed, not lost — resuming
   * renders from current state, so a prop that changed in the window is picked up.
   */
  hydrationPending?: boolean;
  /**
   * The server render this component belongs to, so async work it starts can be
   * awaited before serializing. Inherited from the parent exactly like `env`;
   * undefined on the client. See core/serverWork.ts.
   */
  serverWork?: ServerWork;
  /**
   * Set once the component has been torn down. Kept separate from
   * `isInitialized` on purpose: that one means "not built yet" (hydration and
   * @created rely on the distinction), and a destroyed component is the opposite
   * end of the life cycle, not the same state.
   */
  isDestroyed?: boolean;
  enhancedNode?: MaybeEnhancedNode | ChildNode;
  /**
   * The resolved host tag, cached for this instance's lifetime. `""` means "the
   * default <ramonda-host>" and is cached too, so a component with no @Host does
   * not re-resolve on every render.
   *
   * Cached rather than recomputed because the host element IS the component: it
   * must not change under a live instance. A prop change that would resolve to a
   * different tag is handled in the diff, which declines the match and builds a
   * new component — see helpers/hostTag.ts.
   */
  hostTag?: string;
  /**
   * Which side this component was rendered on. Fixed at creation and inherited
   * from the parent, so a re-render that happens after the server render has
   * handed back control still knows it is on the server. See `renderEnv.ts`.
   */
  env: RenderEnv;
}

export interface HookRuntime {
  /**
   * The props this hook was given, **never undefined** — `createHookRuntime`
   * normalises a missing bag to `{}`.
   *
   * That guarantee used to live in `useCommon` (`hookProps ?? {}`) while this
   * type still said it could be absent, so the props proxy asserted it with a
   * non-null `!`. The assertion happened to hold, but only because every caller
   * remembered — and `createContext`'s Consumer passes `undefined` straight
   * through, which the type permitted and nothing checked. Normalising here makes
   * it structural instead of a convention.
   */
  rawProps: Record<string, unknown>;
  propsSignals: Map<string, State<unknown>>;
}

export const GLOBAL_RUNTIME = Symbol("globalRuntime");
export const COMPONENT_RUNTIME = Symbol("componentRuntime");
export const HOOK_RUNTIME = Symbol("hookRuntime");
export const INTERNAL_HOOKS = Symbol("internalHooks");
// Child hook instances of a component/hook, in `use()` order — a deterministic
// tree used to serialize/restore state across the server→client boundary.
export const CHILD_HOOKS = Symbol("childHooks");

export const createRuntime = (that: BaseComponent<unknown>, context: Context): Runtime => {
  const runtime: Runtime = {
    reBuild: () => addTaskToQueue(that),
    mounts: [],
    hooksOptions: [],
    effects: [],
    updates: [],
    context,
    clearReactives: [],
    id: createId(),
    creates: [],
    destroys: [],
    watchProps: [],
    deferHydrations: [],
    // `that` is the component — `createRuntime` is only ever called from
    // `Component`'s constructor. No extra retention: `reBuild` already closes
    // over the same object.
    owner: that,
  };

  // The DEV-only twin of `owner`, kept separate because a diagnostic reads it and
  // production must not: same object, stripped from the prod build.
  if (__DEV__) runtime.holder = that;

  return runtime;
};

export const createComponentRuntime = (
  rawProps: Record<string | symbol, unknown> | undefined,
  env: RenderEnv = "client",
): ComponentRuntime => {
  return {
    rawProps: rawProps ?? {},
    depth: 1,
    propsSignals: new Map<string, State<unknown>>(),
    env,
  };
};

export const createHookRuntime = (rawProps: HookProps): HookRuntime => {
  return {
    // A hook with no props still needs a bag to read from — see HookRuntime.
    rawProps: rawProps ?? {},
    propsSignals: new Map<string, State<unknown>>(),
  };
};
