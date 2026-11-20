import type { EnclosingBlock } from "./enclosingBlock";
import type { Context } from "../types/commonTypes";
import type { Effect } from "../reactivity/effect";
import type { BaseComponent, ComponentRegion, LifecycleEntry, WatchPropEntry } from "../types/vdom";
import { createId } from "../helpers/createId";
import { addTaskToQueue } from "./Task";
import type { State } from "../reactivity/State";
import type { HookProps } from "../types/HookTypes";
import type { RenderEnv } from "./renderEnv";
import type { ServerWork } from "./serverWork";

export interface Runtime {
  id: number;
  /**
   * The context this component reads and its children inherit: its parent's own object until it
   * publishes something — see `contextToWrite`.
   */
  context: Context;
  /** Whether `context` is this component's own object rather than its parent's. */
  ownsContext: boolean;
  mounts: readonly LifecycleEntry[];
  creates: readonly LifecycleEntry[];
  destroys: readonly LifecycleEntry[];
  watchProps: readonly WatchPropEntry[];
  /**
   * `@deferHydration` methods, bound. Called only while hydrating; each may
   * return a promise, and hydration waits for all of them.
   */
  deferHydrations: readonly (() => unknown)[];
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
   *
   * **Required, and it was optional until 2026-08-21 for no reason anybody could name.** Measured:
   * `createComponentRuntime` is the only producer of a `Runtime`, it is called from one line — `Component`'s
   * constructor — and it always passes `this`; nothing anywhere clears the field afterwards. The
   * optionality was a type lie, and it cost two `?.` at every use plus an argument about what a
   * missing owner should mean. `owner: BaseComponent` type-checks every package in the workspace,
   * which is the proof the lie was free to remove.
   */
  owner: BaseComponent;
  effects: readonly Effect[];
  /**
   * `@updated` methods, bound. Run after the DOM of an UPDATE is committed —
   * never for the first commit, which is `@mounted`'s.
   *
   * Plain thunks rather than `Effect`s, and that is the whole point of the
   * decorator: nothing here is tracked, so there are no dependencies to record,
   * nothing to attach or detach, and no cleanup to run. See `runComponentUpdates`.
   */
  updates: readonly (() => void)[];
  clearReactives: readonly (() => void)[];
  reBuild(): void;
}

/** A component's own fields, on the same object as its `Runtime` — see `createComponentRuntime`. */
export interface ComponentRuntime extends Runtime {
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
  propsSignals: PropSignals;
  /** Whether construction is over — see `finishConstruction`. */
  constructed: boolean;
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
  /**
   * The portal whose block this component renders in, if any — so a portal it owns closes and opens
   * with that one. Set from the region being reconciled when the component is built there, and
   * otherwise taken from the parent, like `env`.
   */
  block?: EnclosingBlock;
  /**
   * This component's entry in its parent's child record: the nodes it owns, in order, and the parent
   * they sit in.
   *
   * What `enhancedNode` used to be, and it had to change shape rather than move: a component owns a
   * RANGE, so "the node this component is" has no answer once a render may return two nodes or none.
   * A render this component schedules for itself reconciles through here — see
   * `refreshComponentRegion`.
   */
  region?: ComponentRegion;
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
  propsSignals: PropSignals;
  /** Whether construction is over — see `finishConstruction`. */
  constructed: boolean;
}

export const GLOBAL_RUNTIME = Symbol("globalRuntime");
export const COMPONENT_RUNTIME = Symbol("componentRuntime");
export const HOOK_RUNTIME = Symbol("hookRuntime");
export const INTERNAL_HOOKS = Symbol("internalHooks");

/**
 * The context a component publishes on — its own object, made here the first time it publishes.
 *
 * A component reads its parent's context object until then, and so do the children it builds: most
 * components publish nothing, and an own object for each was `Object.create(parent)` per component —
 * measured in Chrome after creating 1,000 rows of five components, every component with a child
 * became a PROTOTYPE, 1.4 hidden classes and a prototype record per component. Made at the first
 * publish, the object is in place before any child is built: a Provider is a hook, made with its
 * owner (RMD063), and `Head` publishes in `@created` — both before the owner renders.
 *
 * Made with `Object.create(parent)`, so a read still walks to the nearest ancestor that published,
 * and a write lands as an OWN property, which keeps it from the component's siblings.
 */
export function contextToWrite(runtime: Runtime): Context {
  if (!runtime.ownsContext) {
    runtime.context = Object.create(runtime.context) as Context;
    runtime.ownsContext = true;
  }
  return runtime.context;
}

/**
 * A component's or hook's prop signals, by prop name — one made the first time a prop is read.
 *
 * An instance of a class whose prototype holds nothing, not even `Object.prototype`, rather than a `Map`:
 * a `Map` keeps a hash table of its own, and nearly every component reads one or two props. Measured in
 * Chrome after creating 1,000 rows of five components: the store was a `Map` and its table, about 86 B
 * of the 644 B a component kept. An instance of a class is a fast object whose fields sit in it. With
 * nothing in its prototype, `signals.constructor` or `signals.toString` is `undefined` — a prop may be
 * named anything — where `{}` would answer from `Object.prototype`. `Object.create(null)` would answer
 * the same, but V8 keeps it as a dictionary, as large as the `Map`.
 */
export interface PropSignals {
  [prop: string]: State<unknown> | undefined;
}

class PropSignalStore {}
Object.setPrototypeOf(PropSignalStore.prototype, null);
delete (PropSignalStore.prototype as { constructor?: unknown }).constructor;

/** The hooks an owner walks on each update, in `use()` order: each one's update. */
export type HookWalk = (() => void)[];

/**
 * Marks a component or hook as constructed: from here on, `use()` on it throws (RMD063).
 *
 * Written by whoever calls `new`, once it returns: the base constructors run FIRST, before a subclass's
 * field initializers, so nothing inside the instance can mark the end of its own construction. The
 * framework calls `new` in three places — a component built by the diff, one adopted by hydration, and
 * a hook in `use()` — and each marks what it built.
 *
 * On the runtime the instance already has, not in a `WeakSet`: measured in Chrome, a set that had held
 * every component of 1,000 rows kept its 64 KB table after the rows were cleared.
 */
export function finishConstruction(instance: object): void {
  runtimeOf(instance).constructed = true;
}

/** Whether a component or hook has finished being constructed. */
export function isConstructed(instance: object): boolean {
  return runtimeOf(instance).constructed;
}

/** A hook's own runtime, or a component's — the one that says whether it is constructed. */
function runtimeOf(instance: object): { constructed: boolean } {
  const of = instance as { [HOOK_RUNTIME]?: HookRuntime; [COMPONENT_RUNTIME]: ComponentRuntime };
  return of[HOOK_RUNTIME] ?? of[COMPONENT_RUNTIME];
}

// Child hook instances of a component/hook, in `use()` order — a deterministic
// tree used to serialize/restore state across the server→client boundary.
export const CHILD_HOOKS = Symbol("childHooks");

/**
 * The one empty list every runtime starts with, in each of its lists, until something is added — see `addTo`.
 *
 * Most components declare no `@mounted`, no `@effect`, no `@updated`: measured in Chrome after creating
 * 1,000 rows of five components, the eight lists were eight empty arrays per component, 144 B of the
 * 1,602 each component held. Frozen, so a `push` that bypasses `addTo` throws instead of handing its
 * entry to every component at once.
 */
const NONE: readonly never[] = Object.freeze([]);

/** The names of a runtime's lists. */
type RuntimeList =
  | "mounts"
  | "creates"
  | "destroys"
  | "watchProps"
  | "deferHydrations"
  | "effects"
  | "updates"
  | "clearReactives";

type EntryOf<L> = L extends readonly (infer E)[] ? E : never;

/**
 * Adds an entry to one of a runtime's lists — the only way one is added, which the `readonly` on each
 * list enforces. A list still holding `NONE` gets an array of its own here, on its first entry.
 *
 * A loop already walking that list is unaffected either way: a list that was `NONE` when the loop began
 * had nothing to walk, and one that was already its own is pushed onto in place.
 */
export function addTo<K extends RuntimeList>(runtime: Runtime, key: K, entry: EntryOf<Runtime[K]>): void {
  const list: unknown = runtime[key];
  if (list === NONE) {
    (runtime as unknown as Record<K, unknown[]>)[key] = [entry];
    return;
  }
  (list as unknown[]).push(entry);
}

/**
 * A component's runtime: ONE object, which the instance holds under both `GLOBAL_RUNTIME` and
 * `COMPONENT_RUNTIME`. The two halves were two objects made side by side in `Component`'s constructor
 * and never apart for a moment of their lives; one object is one allocation fewer per component and
 * one shape. A hook is handed this same object as its `GLOBAL_RUNTIME` — its owner's — and keeps a
 * `HookRuntime` of its own.
 *
 * Every field it will ever hold is written here, the optional ones as `undefined`. A field added later
 * — `parent`, `block` and `region` are set while the component is built, the flags through its life —
 * changes the object's hidden class, and V8 then keeps it in a separate property array. Measured in
 * Chrome after creating 1,000 rows of five components: 3.4 property arrays per component (about
 * 120 B), and one more shape transition for each field. Written here, every runtime has the same shape
 * from birth, and its fields stay in the object.
 */
/**
 * The class a component's runtime is an instance of — so `reBuild` is ONE method on its prototype rather
 * than a closure made for every component, and the runtime itself is what a component's signals call:
 * `State.heardBy(value, runtime.id, runtime)`. Measured in Chrome after creating 1,000 rows of five
 * components: the `reBuild` closure and the scope it kept were 48 B of the 582 B a component kept.
 */
class ComponentRuntimeRecord {
  mounts: readonly LifecycleEntry[] = NONE;
  effects: readonly Effect[] = NONE;
  updates: readonly (() => void)[] = NONE;
  context: Context;
  ownsContext = false;
  clearReactives: readonly (() => void)[] = NONE;
  id: number = createId();
  creates: readonly LifecycleEntry[] = NONE;
  destroys: readonly LifecycleEntry[] = NONE;
  watchProps: readonly WatchPropEntry[] = NONE;
  deferHydrations: readonly (() => unknown)[] = NONE;
  owner: BaseComponent;
  holder?: object;
  rawProps: Record<string | symbol, unknown>;
  depth = 1;
  propsSignals: PropSignals = new PropSignalStore() as PropSignals;
  env: RenderEnv = "client";
  constructed = false;
  catchError: ((e: unknown) => unknown) | undefined = undefined;
  parent: BaseComponent | undefined = undefined;
  inBuildQueue: boolean | undefined = undefined;
  isInitialized: boolean | undefined = undefined;
  hydrationPending: boolean | undefined = undefined;
  serverWork: ServerWork | undefined = undefined;
  isDestroyed: boolean | undefined = undefined;
  block: EnclosingBlock | undefined = undefined;
  region: ComponentRegion | undefined = undefined;

  constructor(that: BaseComponent<unknown>, context: Context, rawProps: Record<string | symbol, unknown> | undefined) {
    this.context = context;
    this.owner = that;
    this.rawProps = rawProps ?? {};
  }

  /** Re-renders the component: queues it — see `addTaskToQueue`. */
  reBuild(): void {
    addTaskToQueue(this.owner);
  }
}

/**
 * A component's runtime: ONE object, which the instance holds under both `GLOBAL_RUNTIME` and
 * `COMPONENT_RUNTIME`. The two halves were two objects made side by side in `Component`'s constructor
 * and never apart for a moment of their lives; one object is one allocation fewer per component and
 * one shape. A hook is handed this same object as its `GLOBAL_RUNTIME` — its owner's — and keeps a
 * `HookRuntime` of its own.
 *
 * Every field it will ever hold is there from construction, the optional ones as `undefined` (see
 * `ComponentRuntimeRecord`). A field added later — `parent`, `block` and `region` are set while the
 * component is built, the flags through its life — changes the object's hidden class, and V8 then keeps
 * it in a separate property array. Measured in Chrome after creating 1,000 rows of five components:
 * 3.4 property arrays per component (about 120 B), and one more shape transition for each field.
 */
export const createComponentRuntime = (
  that: BaseComponent<unknown>,
  context: Context,
  rawProps: Record<string | symbol, unknown> | undefined,
): ComponentRuntime => {
  const runtime = new ComponentRuntimeRecord(that, context, rawProps);

  // The DEV-only twin of `owner`, kept separate because a diagnostic reads it and
  // production must not: same object, stripped from the prod build.
  if (__DEV__) runtime.holder = that;

  return runtime;
};

export const createHookRuntime = (rawProps: HookProps): HookRuntime => {
  return {
    // A hook with no props still needs a bag to read from — see HookRuntime.
    rawProps: rawProps ?? {},
    propsSignals: new PropSignalStore() as PropSignals,
    constructed: false,
  };
};
