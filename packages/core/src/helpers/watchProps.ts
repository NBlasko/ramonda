import { COMPONENT_RUNTIME, GLOBAL_RUNTIME } from "../core/runtime";
import type { BaseComponent, WatchPropEntry } from "../types/vdom";
import { ramondaLog } from "../debug/logger";

/**
 * A selector may reach deep into props (`p => p.foo[5].bar`). If it asks for a
 * value that is not there, the access throws — caught here and turned into
 * undefined, so one careless selector cannot take the app down. DEV logs the
 * error along with the fix.
 */
function safeSelect(entry: WatchPropEntry, props: unknown, component: BaseComponent<any>): unknown {
  try {
    return entry.selector(props);
  } catch (e) {
    if (__DEV__) {
      ramondaLog(
        "error",
        `[watchProp] The selector in <${component.constructor.name} /> threw — most likely it reads a value that is not there. Guard the path while you drill into it (e.g. \`p.foo?.[5]?.bar\`). Returning undefined so the app keeps running.`,
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

  const props = component[COMPONENT_RUNTIME].rawProps;
  for (const entry of watchProps) {
    entry.lastValue = safeSelect(entry, props, component);
  }
}

/**
 * Called at the top of updateBuild, BEFORE inBuildQueue is cleared, so a state
 * write inside a callback joins the render already in flight instead of
 * scheduling a second pass. Fires a callback only when its selected value
 * actually changed.
 */
export function runWatchProps(component: BaseComponent<any>) {
  const watchProps = component[GLOBAL_RUNTIME].watchProps;
  if (!watchProps.length) return;

  const props = component[COMPONENT_RUNTIME].rawProps;
  for (const entry of watchProps) {
    const newValue = safeSelect(entry, props, component);
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
