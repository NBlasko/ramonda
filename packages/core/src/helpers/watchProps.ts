import { COMPONENT_RUNTIME, GLOBAL_RUNTIME, HOOK_RUNTIME } from "../core/runtime";
import type { BaseComponent, WatchPropEntry } from "../types/vdom";
import { ramondaLog } from "../debug/logger";

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
 * `@effect` costs) was unreachable.
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
  // the same test `@shouldUpdateOnPropsChange` uses to tell the two apart.
  const componentRuntime = owner[COMPONENT_RUNTIME];
  if (componentRuntime) return componentRuntime.rawProps;
  return owner[HOOK_RUNTIME]?.rawProps;
}

function ownerName(entry: WatchPropEntry): string {
  return (entry.owner as { constructor?: { name?: string } }).constructor?.name ?? "Unknown";
}

/**
 * A selector may reach deep into props (`p => p.foo[5].bar`). If it asks for a
 * value that is not there, the access throws — caught here and turned into
 * undefined, so one careless selector cannot take the app down. DEV logs the
 * error along with the fix.
 */
function safeSelect(entry: WatchPropEntry, props: unknown): unknown {
  try {
    return entry.selector(props);
  } catch (e) {
    if (__DEV__) {
      ramondaLog(
        "error",
        `[watchProp] The selector in <${ownerName(entry)} /> threw — most likely it reads a value that is not there. Guard the path while you drill into it (e.g. \`p.foo?.[5]?.bar\`). Returning undefined so the app keeps running.`,
        e,
      );
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
    entry.lastValue = safeSelect(entry, readWatchedProps(entry));
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
    const newValue = safeSelect(entry, readWatchedProps(entry));
    const oldValue = entry.lastValue;

    if (!Object.is(newValue, oldValue)) {
      entry.lastValue = newValue;
      entry.cb(newValue, oldValue);
    }
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
