import { diagnose } from "./diagnostics";
import type { BaseComponent } from "../types/vdom";

/**
 * DEV-only leak detector for timers.
 *
 * A raw `setInterval` started in @create/@mount or a subscription keeps running after the
 * component is gone — it holds the component alive, and it keeps firing against
 * state nobody is showing. There is no way to see it from the outside, so we
 * watch the timers themselves.
 *
 * `window.setInterval` and friends are patched once, and every timer created
 * while a component's lifecycle is running is attributed to that component.
 * When the component unmounts, anything still ticking is a leak.
 *
 * Timers created outside a lifecycle (say, from a click handler) have no owner
 * to attribute them to and are ignored rather than guessed at.
 */

/** The component whose lifecycle is running right now, if any. */
export const timerOwner: { component: BaseComponent | undefined } = {
  component: undefined,
};

interface TrackedTimer {
  id: number;
  kind: "setInterval" | "setTimeout";
  ms: number;
}

const byComponent = new WeakMap<BaseComponent, Map<number, TrackedTimer>>();
/** Reverse lookup so clearInterval(id) can find the owner without a scan. */
const owners = new Map<number, BaseComponent>();

let installed = false;

function track(component: BaseComponent, timer: TrackedTimer): void {
  let timers = byComponent.get(component);
  if (!timers) {
    timers = new Map();
    byComponent.set(component, timers);
  }
  timers.set(timer.id, timer);
  owners.set(timer.id, component);
}

function untrack(id: number): void {
  const component = owners.get(id);
  if (!component) return;
  owners.delete(id);
  byComponent.get(component)?.delete(id);
}

/** Patches the global timer functions. Safe to call more than once. */
export function installTimerGuard(): void {
  if (installed) return;
  if (typeof window === "undefined") return;
  installed = true;

  const nativeSetInterval = window.setInterval;
  const nativeSetTimeout = window.setTimeout;
  const nativeClearInterval = window.clearInterval;
  const nativeClearTimeout = window.clearTimeout;

  window.setInterval = function (handler: TimerHandler, ms?: number, ...args: unknown[]): number {
    const id = nativeSetInterval(handler, ms, ...args);
    const owner = timerOwner.component;
    if (owner) track(owner, { id, kind: "setInterval", ms: ms ?? 0 });
    return id;
  } as typeof window.setInterval;

  window.setTimeout = function (handler: TimerHandler, ms?: number, ...args: unknown[]): number {
    const owner = timerOwner.component;
    if (!owner || typeof handler !== "function") {
      return nativeSetTimeout(handler, ms, ...args);
    }

    // A timeout that fires is finished, not leaked — drop it on the way out.
    let id: number;
    const wrapped = (...callArgs: unknown[]) => {
      untrack(id);
      return (handler as (...a: unknown[]) => unknown)(...callArgs);
    };
    id = nativeSetTimeout(wrapped, ms, ...args);
    track(owner, { id, kind: "setTimeout", ms: ms ?? 0 });
    return id;
  } as typeof window.setTimeout;

  window.clearInterval = function (id?: number): void {
    if (id != null) untrack(id);
    nativeClearInterval(id);
  } as typeof window.clearInterval;

  window.clearTimeout = function (id?: number): void {
    if (id != null) untrack(id);
    nativeClearTimeout(id);
  } as typeof window.clearTimeout;
}

/**
 * Reports timers a component left running. Call after @destroy and after effect
 * cleanups have had their chance to clear them.
 */
export function reportLeakedTimers(component: BaseComponent): void {
  const timers = byComponent.get(component);
  if (!timers || timers.size === 0) return;

  const name = component.constructor.name;

  for (const timer of timers.values()) {
    diagnose(
      "RMD006",
      `${name}:${timer.kind}:${timer.ms}`,
      `<${name} /> unmounted with a ${timer.kind}(…, ${timer.ms}) still running.`,
    );
    owners.delete(timer.id);
  }

  byComponent.delete(component);
}

/** Test-only: forgets everything tracked so far. */
export function resetTimerGuard(): void {
  owners.clear();
}
