import { attach, detach } from "../helpers/constants";
import { reactivityScope, trackDependency } from "./tracker";
import { reportWriteDuringRender, reportWriteDuringCompute, reportWriteDuringInspect } from "../debug/renderPhase";
import { guardArray, unwrapArray } from "../debug/mutationGuard";
import { labelState } from "../debug/stateLabels";

interface Listener {
  onChange: () => void;
  id: number;
}

export type ShouldUpdateState<T> = (previousValue: T, nextValue: T) => boolean;

export interface StateOptions<T> {
  listener?: Listener;
  shouldUpdate?: ShouldUpdateState<T>;
  /** Property name this signal backs, e.g. "items". DEV debug output only. */
  metaData?: string;
  /** Class that owns the property, e.g. "TodoList". DEV debug output only. */
  owner?: string;
}

/**
 * The reactive primitive. An app holds thousands of these and `set` runs on
 * every state change, so the shape is kept deliberately small:
 *
 * Internal to the framework: apps reach reactivity through @state / @compute /
 * context, never through this class.
 *
 * - **No debug fields.** Names live in a DEV-only WeakMap (`debug/stateLabels`),
 *   because a declared field costs a slot per instance even when never assigned.
 * - **Listeners start as a single slot.** Nearly every signal has exactly one
 *   listener — the owning component's `reBuild` — so the Map is allocated only
 *   when a second one arrives. That is most of the memory difference.
 * - **No snapshot on the common path.** `Array.from(listeners.values())` used to
 *   allocate on every set; with one listener there is nothing to snapshot.
 */
export class State<T> {
  private _value: T;

  /** The only listener, while there is only one. */
  private _listener: (() => void) | undefined;
  private _listenerId: number | string | undefined;
  /** Allocated on the second listener; from then on it is the only store. */
  private _listeners: Map<number | string, () => void> | undefined;

  constructor(initialValue: T, options?: StateOptions<T>) {
    this._value = initialValue;

    if (options !== undefined) {
      const listener = options.listener;
      if (listener !== undefined) {
        this._listenerId = listener.id;
        this._listener = listener.onChange;
      }

      if (options.shouldUpdate !== undefined) {
        this.shouldUpdate = options.shouldUpdate;
      }

      if (__DEV__) {
        if (options.metaData) {
          labelState(this, options.metaData, options.owner);
        }
      }
    }
  }

  [attach](listener: { id: number | string; onChange: () => void }) {
    const map = this._listeners;
    if (map !== undefined) {
      map.set(listener.id, listener.onChange);
      return;
    }

    // First listener, or a replacement for the one already held.
    if (this._listener === undefined || this._listenerId === listener.id) {
      this._listenerId = listener.id;
      this._listener = listener.onChange;
      return;
    }

    // Second listener: upgrade to the Map and stop using the single slot.
    const upgraded = new Map<number | string, () => void>();
    upgraded.set(this._listenerId as number | string, this._listener);
    upgraded.set(listener.id, listener.onChange);
    this._listeners = upgraded;
    this._listener = undefined;
    this._listenerId = undefined;
  }

  [detach](id: number | string) {
    const map = this._listeners;
    if (map !== undefined) {
      map.delete(id);
      return;
    }

    if (this._listenerId === id) {
      this._listener = undefined;
      this._listenerId = undefined;
    }
  }

  get(): T {
    // Records this read against the effect or the tracker that is running, if
    // either is — see trackDependency, which a @compute calls too so that a
    // cache hit subscribes its reader to exactly what a miss would have.
    trackDependency(this as any);

    if (__DEV__) {
      // Arrays go out behind a guard that reports in-place mutation (RMD005).
      // Anything else is returned untouched. The signal is passed rather than a
      // name so the label is only looked up for arrays, once per array.
      return guardArray(this._value, this);
    }

    return this._value;
  }

  shouldUpdate(prev: T, next: T) {
    // Strict on purpose. Loose `!=` coerces, so `0 != "0"`, `"" != 0` and
    // `1 != true` are all false — the value changes and nothing re-renders.
    // It is not faster either: when the types match, `!=` runs the strict
    // algorithm anyway, after a type check.
    return prev !== next;
  }

  set(newValue: T) {
    if (__DEV__) {
      // Store the plain array, never the guard proxy. Keeps `_value` identical
      // to what production holds, so `shouldUpdate` reaches the same verdict in
      // both — including for `arr.push(x); this.items = arr`, which must not
      // re-render in either (it was already reported above).
      newValue = unwrapArray(newValue);

      // A write inside a @compute is reported before shouldUpdate: deriving is
      // meant to be pure, so even a write that changes nothing is a mistake to
      // surface, not the render-time no-op that RMD001 deliberately lets pass.
      reportWriteDuringCompute(this);

      // Beside the compute check, and before shouldUpdate, for the same reason: describing an
      // instance is meant to be a pure read, so a write that changes nothing is still the mistake.
      reportWriteDuringInspect(this);
    }

    // First check shouldUpdate — if it prevents update, don't mark mutated
    if (!this.shouldUpdate(this._value, newValue)) {
      return;
    }

    if (__DEV__) {
      // Checked after shouldUpdate: a write that changes nothing schedules no
      // render, so it is not the bug this diagnostic is looking for.
      reportWriteDuringRender(this);
    }

    // If we're inside an effect run, mark that THIS effect mutated THIS signal.
    if (reactivityScope.currentEffect) {
      reactivityScope.currentEffect.mutated.add(this as any);
    }

    // Note: state changes are intentionally NOT logged. They're high-frequency
    // and would flood both the console and the devtools Logs stream. Current
    // values are shown live in the devtools COMPONENTS tab (pull model), and the
    // per-key flash there comes from diffing on the update tick.

    this._value = newValue;

    const single = this._listener;
    if (single !== undefined) {
      single();
      return;
    }

    const map = this._listeners;
    if (map === undefined) return;

    // Snapshot only in the multi-listener case: a listener may attach or detach
    // while being notified, and iterating the live Map would then be undefined.
    const toNotify = Array.from(map.values());
    for (const listener of toNotify) {
      listener();
    }
  }
}
