import { HOOK_RUNTIME, INTERNAL_HOOKS, GLOBAL_RUNTIME, CHILD_HOOKS } from "../core/runtime";
import { className, displayName } from "./utils";
import { STABLE_PROPS, attach, detach } from "./constants";
import { valueEqual } from "./valueEqual";
import { checkPropsStability, checkCachedProps, reportObjectPropsBag } from "../debug/propsStability";
import { isStrictRender } from "../debug/renderStability";
import type { HookClassKind } from "../types/commonTypes";
import { HOOK_META, type BaseHook, type HookMeta, type HookProps } from "../types/HookTypes";
import type { BaseComponent } from "../types/vdom";
import { propsPhase } from "../debug/purityGuard";
import { trackerContainer } from "../reactivity/tracker";
import type { State } from "../reactivity/State";
import { createId } from "./createId";

/**
 * A props bag as this file handles it: keys the hook's author chose, values it cannot know.
 *
 * `unknown` rather than `any` because nothing here reads INTO a value — the bag is built, compared,
 * cached and handed on, and every one of those is done by key. The one type argument the outside
 * world sees is still the hook's own `Q`; this is the shape the machinery in between works in.
 */
type Bag = Record<string, unknown>;

/** Stands in for a cache that has not built yet. Shared, and never read — see `PropsCache.bag`. */
const NO_BAG: Bag = {};

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
function buildProps(
  that: object,
  hookName: string,
  hookProps: unknown,
  declared: readonly string[] | undefined,
  site?: PropsCache,
): Bag {
  // `undefined` is the whole of the other case: a bag passed as a plain object is refused by
  // `useCommon` before anything is built (RMD055), so nothing else reaches here.
  if (hookProps === undefined) return {};

  const build = hookProps as (owner: unknown) => Bag;

  // `if (__DEV__) { … }` around the whole thing, not `if (!__DEV__) return build(that)`
  // with the checks after it. The two read the same but bundle differently: an early
  // return leaves the rest of the body reachable as far as esbuild's dead-code pass is
  // concerned, so `checkPropsStability` stayed referenced in a production build and
  // dragged `diagnose` — and with it every diagnostic's title and fix text — into the
  // bundle. Caught by apps/docs' `ProdAppBuild.test.ts`, which still guards it.
  //
  // The count that used to be written here (21) is left out on purpose: it was true on the
  // day and there are more than twice as many now, so a number here only ages.
  if (__DEV__) {
    const label = `${displayName(that)} → ${hookName}`;
    const previous = propsPhase.label;
    propsPhase.label = label;
    try {
      const bag = build(that);

      // A second call, compared against the first — the same check `render()` gets, on
      // the other place the framework asks the app for a value. See
      // debug/propsStability.ts for why twice in one tick, and why a run counter on top.
      //
      // `site` is the call site's props cache, which the check counts runs against. It is absent
      // only for a hook taking no props at all, and that returned above — there is no callback to
      // run twice, so there is nothing for this check to be about.
      //
      // A callback that reads no signal needs no guard here, and it was measured for one: nothing
      // can mark its cache dirty, so it is built exactly once, and the churn report needs four
      // builds of the same callback before it speaks. What WAS reporting such a bag is the
      // comparison behind the wording, which is thorough now — see `classify`.
      if (isStrictRender() && site !== undefined) checkPropsStability(label, bag, build(that), declared, site);

      return bag;
    } finally {
      propsPhase.label = previous;
    }
  }

  return build(that);
}

/**
 * Calls the callback for an OBSERVATION rather than for a bag — the RMD027 freshness probe.
 *
 * Deliberately not `buildProps`: that one runs the RMD022 strict-render check, which would then
 * fire from inside a check of its own. Two things went wrong when it did. It reported churn on a
 * render where the callback was NOT going to be called, so the "rebuilt on every render" the
 * message describes was not happening; and the probe has no `declared` list to hand down, so
 * every `@StableProps` key was reported as unstable — the framework recommending its own
 * declaration as the fix for a fault it had just invented.
 *
 * The phase marker stays, so RMD021 still attributes randomness read here to the bag.
 */
function probeProps(that: object, hookName: string, hookProps: unknown): Bag {
  const previous = propsPhase.label;
  propsPhase.label = `${displayName(that)} → ${hookName}`;
  try {
    return (hookProps as (owner: unknown) => Bag)(that);
  } finally {
    propsPhase.label = previous;
  }
}

/**
 * Gives every prop a hook DECLARED as a value an identity that survives while its contents do —
 * the previous render's value for that key, when the two are equal.
 *
 * Runs in every build, not only development: this is the behaviour `@StableProps` promises, and
 * the diagnostic that recommends it is separate. A class that declared nothing skips the whole
 * loop, which is the common case.
 *
 * Shared with the diff, which does the same for a COMPONENT's props — the declaration means one
 * thing wherever it is written, and two copies of it would be two chances to disagree.
 */
export function resolveStable(next: Bag, prev: Bag | undefined, declared: readonly string[] | undefined): Bag {
  if (declared === undefined) return next;

  let resolved: Bag | undefined;

  for (const key in next) {
    if (!declared.includes(key)) continue;

    const inner = next[key];

    // A declaration cannot make a function comparable — two closures with the same body
    // are not equal by any comparison that is safe to make — so a function prop is left
    // exactly as it came, and RMD022 still reports it. Silently accepting it would be the
    // worst of both: unstable AND unreported.
    if (typeof inner === "function") continue;

    const target = resolved ?? (resolved = { ...next });
    const before = prev?.[key];
    // An equal previous value is handed straight back, so every signal that reads this prop
    // stays asleep.
    target[key] = before !== undefined && valueEqual(inner, before, STABLE_DEPTH) ? before : inner;
  }

  return resolved ?? next;
}

/**
 * Deeper than the diagnostic's default, because `@StableProps` is a declaration: the hook said
 * this prop is a value, and the payload is its own — a query key, a filter object. Past the
 * bound a fresh reference is handed back, which is correct but not optimal.
 */
const STABLE_DEPTH = 5;

/**
 * The props callback, cached on the signals it read — the same contract `@compute` gives a
 * getter, applied to the one other place the framework asks the app for a value on every render.
 *
 * ## Why the callback is cached rather than called
 *
 * Every prop is a signal, so a fresh reference is a change. A callback written the natural way
 * (`() => ({ filter: { q: this.q }, onPick: x => this.pick(x) })`) rebuilt its bag on every render
 * of the owner, and each rebuilt object woke the prop signal holding it — so a `@compute` inside
 * the hook recomputed, a `@watchProp` fired, a subscription reconnected, all because the OWNER
 * rendered for an unrelated reason. Measured in `PropsFactoryCache.test.tsx`: ten hooks, five
 * renders, one changed signal — 50 callback calls and 50 hook recomputes, where 5 and 5 is the
 * whole of the work that changed.
 *
 * The fix used to be the app's to write: hold the value in a `@compute` and pass that along, which
 * RMD022 recommends. That works, and it is ceremony the framework can do instead — the callback
 * already reads its inputs through signals, so what it depends on is observable without being
 * declared.
 *
 * ## The cost, honestly
 *
 * A CLEAN pass is one boolean. A DIRTY pass costs MORE than calling the callback used to: the
 * dependency set is detached, re-tracked and re-attached, and a signal read by a callback gains a
 * second listener, which promotes `State` off its single-listener slot onto a `Map`. So this is a
 * trade, not a free win, and it pays exactly when hooks outnumber the signals that changed —
 * which is the shape of a hook-heavy app.
 *
 * ## What it does not do
 *
 * It does not skip the owner's render, and it does not skip the walk: `updateFn` still visits
 * every child hook, because a child can depend on state of its own that the parent's bag says
 * nothing about. Only the CALL and the prop diff are skipped.
 */
interface PropsCache {
  /**
   * The bag from the last build — meaningful only while `isDirty` is false, which is the same
   * thing that is already true of a stale one, so there is one rule and not two.
   *
   * Starts as the shared `NO_BAG`, because `isDirty` starts true and the first `readProps` builds
   * before anything can read this. One object for every hook in the app rather than one per use,
   * and typing it as a bag rather than as possibly-absent is what keeps the read at the bottom of
   * `readProps` free of an assertion.
   */
  bag: Bag;
  isDirty: boolean;
  deps: Set<State<unknown>>;
  addDep(s: State<unknown>): void;
}

export function useCommon<T extends BaseHook<unknown>, P>(
  that: BaseComponent<P> | BaseHook<HookProps>,
  hook: HookClassKind<T, any>,
  hookProps?: unknown,
  meta?: HookMeta,
): T {
  /**
   * A props bag is a CALLBACK, and that is enforced here rather than only typed.
   *
   * An object literal in a field initializer is evaluated ONCE, while the owner is being
   * constructed, so what it captured is what the hook keeps for life: `{ seed: this.n }` written
   * when `n` was 1 serves 1 forever while the owner reads 7, silently. Nothing can detect that
   * from inside `use()` — it is handed an already-built object and cannot know the values came
   * from `this` — so the FORM is what gives way, since the form is the only part that is visible.
   *
   * Enforcement, not diagnostics: the throw sits outside `if (__DEV__)`, like a write to props
   * (RMD004, RMD015), so behaviour cannot differ between builds and a shipped bundle cannot go on
   * serving a stale bag the types already refuse. The DEV report only explains it.
   *
   * The callback costs nothing where the object was chosen for being cheap: a bag that reads no
   * signal runs once, at mount, and never again — measured in `PropsBagRuns.test.tsx`, which also
   * pins what a development build adds and throws away (RMD022's second call, RMD027's probe).
   */
  if (hookProps !== undefined && typeof hookProps !== "function") {
    if (__DEV__) {
      reportObjectPropsBag(
        displayName(that),
        hook.name,
        typeof hookProps === "object" && hookProps !== null ? Object.keys(hookProps) : [],
      );
    }
    throw new TypeError(
      `[RMD055] <${className(hook)} /> was given a plain object as its props in ${displayName(that)} — a hook's props must be a callback: \`this.use(${className(hook)}, () => ({ ... }))\`. An object literal is evaluated once, so it can only ever carry what was true while ${displayName(that)} was being constructed.`,
    );
  }

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

  // A hook taking no props at all pays for none of the machinery below: there is no callback to
  // re-run, so there is nothing to cache and no signal to track.
  const isFactory = hookProps !== undefined;

  const cacheId = isFactory ? createId() : 0;
  const cache: PropsCache | undefined = isFactory
    ? {
        bag: NO_BAG,
        isDirty: true,
        deps: new Set<State<unknown>>(),
        addDep(s: State<unknown>) {
          this.deps.add(s);
        },
      }
    : undefined;

  const invalidate = () => {
    // Synchronous, fired from `State.set` — so by the time the update walk reaches this call
    // site the flag is already correct. That ordering is what makes the walk safe to keep
    // top-down: the parent sets the child's prop signals BEFORE recursing, so a child whose
    // input just moved is marked dirty before it is consulted.
    if (cache) cache.isDirty = true;
  };

  /**
   * The bag for this render — the cached one when nothing it reads has moved.
   *
   * `prevProps` is threaded through to `resolveStable`, so `@StableProps` still settles a
   * rebuilt-but-equal value on the renders where the callback DID run. The two do different
   * jobs: the cache stops the call, the declaration stops the churn inside a call that had to
   * happen anyway.
   */
  const readProps = (prevProps: Bag | undefined): Bag => {
    if (!cache) return resolveStable(buildProps(that, hook.name, hookProps, declaredStable), prevProps, declaredStable);

    if (cache.isDirty) {
      // Detach first, then re-track: a callback with a branch in it reads a DIFFERENT set of
      // signals depending on which way it went, so the old set cannot be assumed to be a subset
      // of the new one.
      for (const dep of cache.deps) dep[detach](cacheId);
      cache.deps.clear();

      const prevTracker = trackerContainer.current;
      trackerContainer.current = cache;

      let raw: Bag;
      try {
        raw = buildProps(that, hook.name, hookProps, declaredStable, cache);
      } finally {
        trackerContainer.current = prevTracker;
      }

      for (const dep of cache.deps) dep[attach]({ id: cacheId, onChange: invalidate });

      cache.bag = resolveStable(raw, prevProps, declaredStable);
      cache.isDirty = false;
    } else if (__DEV__ && isStrictRender()) {
      // RMD027: the cache claims nothing moved. Call the callback anyway and compare — a
      // difference means it read something no signal backs, which is the one way this cache
      // can serve a stale bag. Untracked deliberately: this call is an observation, and letting
      // it record dependencies would make the check change the thing it is checking.
      checkCachedProps(
        `${displayName(that)} → ${className(hook)}`,
        cache.bag,
        probeProps(that, className(hook), hookProps),
      );
    }

    // Whatever this callback read, an enclosing tracker read too. Without this a `use()` nested
    // inside another tracked region would have its dependencies swallowed by this cache — the
    // reads used to reach that tracker directly, and forwarding is what keeps them reaching it.
    // On the HIT path as much as the miss path: a hit touches no signal at all, so a tracker
    // above it would record nothing and never invalidate. That is the same trap `@compute` has
    // to step around, for the same reason.
    const outerTracker = trackerContainer.current;
    if (outerTracker) {
      for (const dep of cache.deps) outerTracker.addDep(dep);
    }

    return cache.bag;
  };

  const initialProps = readProps(undefined);

  const hookInstance = new hook(runtime, initialProps);
  const hookRuntime = hookInstance[HOOK_RUNTIME];

  /**
   * The metadata for THIS `use()`, parked on the instance where anything can find it.
   *
   * Under a registered symbol, read through `Symbol.for` rather than an import: core's inspector and
   * `@ramonda/form`'s own panel both want it, and neither should have to depend on the other to get
   * it. The same shape as the diagnostics sink — a well-known key is the contract, and nothing is
   * imported to honour it.
   *
   * Kept out of the props bag deliberately. A hook's props belong to whoever wrote the hook, so a
   * framework word reserved in there collides with a real one sooner or later; `label` on a form is
   * exactly that collision, because a form is full of labels.
   *
   * DEV only. Nothing reads it in a production build, so nothing stores it there either.
   *
   * **`isExtensible` first, and it is not defensive.** A hook that calls `Object.freeze(this)` in its
   * constructor works everywhere else in this package — measured — and `defineProperty` on it throws
   * `Cannot define property …, object is not extensible`, from a field initializer, before the
   * component exists. That is a cosmetic devtools label taking an application down, and taking it down
   * ONLY IN DEVELOPMENT, since production never reaches this line. A frozen instance cannot carry the
   * property by any means, so the label is what gives way: the hook keeps its class name in the panel.
   */
  if (__DEV__ && meta !== undefined && Object.isExtensible(hookInstance)) {
    Object.defineProperty(hookInstance, HOOK_META, { value: meta, enumerable: false, configurable: true });
  }

  // Track child hook instances in use() order — deterministic tree for hydration.
  const owner = that as { [CHILD_HOOKS]?: BaseHook<unknown>[] };
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
    const nextProps = readProps(prevProps);

    // The cache handed back the same bag, so every key in it is the same value it already had —
    // the diff below would visit each one to prove that and wake nothing. Skipped by IDENTITY,
    // not by a flag: a callback that was re-run and settled by `@StableProps` reaches the same
    // conclusion by the same test.
    //
    // What is NOT skipped is the walk into the children further down. A child hook can depend on
    // state of its own, which this hook's bag says nothing about, so skipping the recursion here
    // would freeze whole subtrees on any render where only their own state moved.
    if (nextProps !== prevProps) {
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

  // The cache holds a listener on every signal its callback read, and those signals outlive the
  // hook — an owner's `@state` belongs to the owner, and a context signal belongs to the
  // provider. Without this the destroyed hook's cache stays subscribed and is invalidated
  // forever by writes it can no longer do anything about.
  if (cache) {
    runtime.clearReactives.push(() => {
      for (const dep of cache.deps) dep[detach](cacheId);
      cache.deps.clear();
    });
  }

  return hookInstance;
}
