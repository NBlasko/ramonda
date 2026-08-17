import { COMPONENT_RUNTIME, GLOBAL_RUNTIME, HOOK_RUNTIME } from "../core/runtime";
import type { BaseComponent, WatchPropEntry } from "../types/vdom";
import { diagnose } from "../debug/diagnostics";
import { displayName } from "./utils";

/**
 * The props the entry's own owner was given.
 *
 * A hook shares its owner component's runtime, so `runtime.watchProps` holds the
 * entries of the component AND of every hook in its tree, in one list. Running
 * that list therefore has to ask each entry whose props it wants — which is what
 * `owner` on the entry is for.
 *
 * Until this existed, every entry was handed `component.rawProps`. On a component
 * that is right and always was; on a hook it was wrong in a way nothing reported:
 * a selector like `p => p.userId` read the OWNER's `userId` — `undefined` when the
 * component has no such prop, or worse, a different value with the same name — and
 * a hook whose own prop changed never fired at all. The decorator's whole purpose
 * on a hook (sync derived state before the render, without the extra pass an
 * an effect costs) was unreachable.
 *
 * Read live rather than captured: `rawProps` is REPLACED on every update
 * (`useCommon`'s update function assigns a new bag, and the build path assigns the
 * component's), so holding a reference to the object would freeze the entry on the
 * props it saw first.
 */
function readWatchedProps(entry: WatchPropEntry): unknown {
  const owner = entry.owner as {
    [COMPONENT_RUNTIME]?: { rawProps: unknown };
    [HOOK_RUNTIME]?: { rawProps: unknown };
  };

  // A component carries COMPONENT_RUNTIME and a hook carries HOOK_RUNTIME, which is
  // the same test `@ShouldUpdateOnPropsChange` uses to tell the two apart.
  const componentRuntime = owner[COMPONENT_RUNTIME];
  if (componentRuntime) return componentRuntime.rawProps;
  return owner[HOOK_RUNTIME]?.rawProps;
}

/**
 * A selector may reach deep into props (`p => p.foo[5].bar`). If it asks for a
 * value that is not there, the access throws — caught here and turned into
 * undefined, so one careless selector cannot take the app down. DEV logs the
 * error along with the fix.
 */
function safeSelect(entry: WatchPropEntry, selector: (props: unknown) => unknown, props: unknown): unknown {
  try {
    return selector(props);
  } catch (e) {
    if (__DEV__) {
      /**
       * The Error itself goes in `data`, and it has to: the throw comes from the app's own selector,
       * so its stack is the line that names the failing path — the one thing `e.message` cannot give
       * and the first thing anybody reads. The console prints `data` whole.
       *
       * It reaches the RECORD as nothing, because `reportable` keeps only primitives: an Error holds
       * its stack, which holds the scope it was thrown from, and a collector's history would keep
       * that alive. So `reason` is the text a record can carry and `error` is for the console, which
       * has held live objects all along.
       */
      diagnose("RMD038", displayName(entry.owner), `The selector in <${displayName(entry.owner)} /> threw.`, {
        component: displayName(entry.owner),
        reason: e instanceof Error ? e.message : String(e),
        error: e,
      });
    }
    return undefined;
  }
}

/**
 * Called at mount: records each selector's starting value WITHOUT firing its
 * callback. `watchProp` reacts to changes, and mount is not one — there is no
 * previous value for the first one to differ from.
 */
export function seedWatchProps(component: BaseComponent<any>) {
  const watchProps = component[GLOBAL_RUNTIME].watchProps;
  if (!watchProps.length) return;

  for (const entry of watchProps) {
    const props = readWatchedProps(entry);
    entry.lastValues = entry.selectors.map((selector) => safeSelect(entry, selector, props));
  }
}

/**
 * Called at the top of updateBuild, BEFORE inBuildQueue is cleared, so a state
 * write inside a callback joins the render already in flight instead of
 * scheduling a second pass. Fires a callback only when its selected value
 * actually changed.
 *
 * It also runs AFTER the hook update pass, which matters now that a hook's entries
 * read the hook's own props: `useCommon` has already installed the new bag by then,
 * so a hook's selector sees this render's props rather than the last one's.
 */
export function runWatchProps(component: BaseComponent<any>) {
  const watchProps = component[GLOBAL_RUNTIME].watchProps;
  if (!watchProps.length) return;

  for (const entry of watchProps) {
    const props = readWatchedProps(entry);
    const next = entry.selectors.map((selector) => safeSelect(entry, selector, props));
    const previous = entry.lastValues;

    /**
     * ONE call when ANY of them moved, not one call per selector.
     *
     * `Object.is` per selector, so nothing is compared deeply and the cost is the same as before. The
     * unchanged ones keep their value in both arrays, which is deliberate: `previous[i] === next[i]`
     * is how the method tells which selector moved, and that is the question a multi-selector watcher
     * is usually asking.
     */
    let changed = false;
    for (let i = 0; i < next.length; i++) {
      if (!Object.is(next[i], previous[i])) {
        changed = true;
        break;
      }
    }
    if (!changed) continue;

    entry.lastValues = next;

    /**
     * The callback gets a COPY of `next`, and that is not caution — it is a bug this closes.
     *
     * `next` is the array just stored as `lastValues`, and a callback is handed a plain array with
     * nothing stopping it writing to one: `next.sort()` to compare, a `push`, an assignment. Measured —
     * a handler setting `next[0] = 999` and shortening it left `lastValues` as `[999]`, so the NEXT
     * call's `previous` was that garbage. Which is precisely the value the documentation tells people to
     * read to learn which selector moved.
     *
     * `previous` needs no copy: `lastValues` has already been replaced above, so nothing holds it and a
     * callback that mutates it corrupts something already discarded. One allocation per FIRE, not per
     * comparison, and a watcher fires rarely by construction.
     */
    entry.cb(next.slice(), previous);
  }
}
// Not a decorator, despite the name — `@watchProp` lives in base/decorators.ts.
// What is here is the runtime half it feeds: `seedWatchProps` records the
// starting values at mount, `runWatchProps` fires the callbacks on change, and
// they are called from the build path, the task queue and hydration. Moving them
// next to the decorator would put render-path code in base/.
//
// That is what `helpers/` is: support the core paths call, never public API. The
// rule is enforced now rather than intended — see __tests__/InternalFolders.test.ts,
// which fails if anything from helpers/, core/, debug/ or reactivity/ is
// re-exported from index.ts.
