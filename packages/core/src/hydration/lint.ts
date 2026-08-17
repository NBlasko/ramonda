import { STATE_KEYS, PERSIST_KEYS } from "../helpers/constants";
import { HOOK_RUNTIME } from "../core/runtime";
import { diagnose } from "../debug/diagnostics";
import { displayName } from "../helpers/utils";

interface PropSnapshot {
  value: unknown;
  /**
   * A shallow serialization, for values where the reference alone cannot tell
   * you whether anything happened. `this.cfg.loaded = true` leaves the reference
   * identical, so comparing references reported "unchanged" — and the mutation
   * is lost after hydration exactly like a reassignment would be.
   */
  shape?: string;
}

/** DEV/server only, so a JSON pass per component at build time is affordable. */
function shapeOf(value: unknown): string | undefined {
  if (value === null || typeof value !== "object") return undefined;
  if (isHookInstance(value) || isRefLike(value)) return undefined;
  try {
    return JSON.stringify(value);
  } catch {
    // Cycles, BigInt, a throwing toJSON — nothing to compare, fall back to the
    // reference check alone rather than making the lint itself the failure.
    return undefined;
  }
}

/** Snapshot of an instance's own-enumerable string props, post-constructor. */
export function snapshotOwnProps(instance: object): Map<string, PropSnapshot> {
  const snap = new Map<string, PropSnapshot>();
  const obj = instance as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    snap.set(key, { value, shape: shapeOf(value) });
  }
  return snap;
}

function isHookInstance(value: unknown): boolean {
  return typeof value === "object" && value !== null && HOOK_RUNTIME in value;
}

function isRefLike(value: unknown): boolean {
  return (
    typeof value === "object" && value !== null && typeof (value as { setCurrent?: unknown }).setCurrent === "function"
  );
}

/**
 * DEV + server only: warns about state produced by shared/server create/mount
 * that isn't `@state`/`@persist`. Under restore-only hydration those phases do
 * NOT re-run on the client, so such a value would be `undefined` after
 * hydration. (@state is non-enumerable so it never shows up here; refs, methods,
 * and hook instances are excluded — they're re-established/re-run on the client.)
 */
export function lintUnpersistedState(instance: object, before: Map<string, PropSnapshot>): void {
  const stateKeys = (instance as { [STATE_KEYS]?: Set<string> })[STATE_KEYS];
  const persistKeys = (instance as { [PERSIST_KEYS]?: Set<string> })[PERSIST_KEYS];
  const obj = instance as Record<string, unknown>;
  const name = displayName(instance);

  for (const key of Object.keys(obj)) {
    const value = obj[key];

    // Cheap exclusions first: they also keep `shapeOf` off values it has no
    // business serializing.
    if (stateKeys?.has(key) || persistKeys?.has(key)) continue;
    if (typeof value === "function") continue;
    if (isHookInstance(value) || isRefLike(value)) continue;

    const previous = before.get(key);
    const changed =
      previous === undefined ||
      !Object.is(previous.value, value) ||
      (previous.shape !== undefined && previous.shape !== shapeOf(value));
    if (!changed) continue;

    diagnose(
      "RMD034",
      `${name}.${key}`,
      `<${name}> changed "${key}" during create/mount, and it is neither @state nor @persist.`,
      {
        component: name,
        key,
      },
    );
  }
}
