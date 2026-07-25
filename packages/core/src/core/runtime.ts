import type { Context, RenderableProps } from "../types/commonTypes";
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
   * The `@shouldUpdateOnPropsChange` predicate, bound. Undefined means the default
   * shallow compare decides — i.e. take the props whenever they differ.
   */
  shouldUpdateOnPropsChange?: (prev: unknown, next: unknown) => boolean;
  effects: Effect[];
  clearReactives: ClearReactives;
  hooksOptions: (() => any)[];
  reBuild(): void;
}

export interface ComponentRuntime {
  depth: number;
  rawProps: RenderableProps<any>;
  propsSignals: Map<string, State<any>>;
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
   * @create rely on the distinction), and a destroyed component is the opposite
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

export const createRuntime = (that: any, context: Context): Runtime => {
  return {
    reBuild: () => addTaskToQueue(that),
    mounts: [],
    hooksOptions: [],
    effects: [],
    context,
    clearReactives: [],
    id: createId(),
    creates: [],
    destroys: [],
    watchProps: [],
    deferHydrations: [],
  };
};

export const createComponentRuntime = (rawProps: unknown, env: RenderEnv = "client"): ComponentRuntime => {
  return {
    rawProps: rawProps ?? ({} as RenderableProps<any>),
    depth: 1,
    propsSignals: new Map<string, State<any>>(),
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
