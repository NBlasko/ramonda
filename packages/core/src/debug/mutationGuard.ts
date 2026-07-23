import { diagnose } from "./diagnostics";
import { stateLabel } from "./stateLabels";

/**
 * DEV-only guard for arrays held in a signal.
 *
 * `this.items.push(x)` mutates the array the signal is already holding. The
 * setter never runs, so nothing re-renders and the framework looks broken. The
 * guard hands out a proxy that reports the mutating call instead of letting it
 * pass silently.
 *
 * Non-mutating reads (`map`, `filter`, `slice`, iteration, `length`) go straight
 * through, and `slice()`/spread return plain arrays — so the copy-then-reassign
 * pattern is untouched.
 */

const ARRAY_MUTATORS = new Set(["push", "pop", "shift", "unshift", "splice", "sort", "reverse", "fill", "copyWithin"]);

/** Reads back the array behind a guard proxy; absent on everything else. */
const RAW = Symbol("ramondaRawArray");

/**
 * One proxy per array instance. Identity has to stay stable: `this.items`
 * returning a fresh proxy each read would break every `===` comparison the diff
 * and `shouldUpdateProps` rely on.
 */
const guarded = new WeakMap<object, unknown[]>();

/** Unwraps a guard proxy back to the plain array, if it is one. */
export function unwrapArray<T>(value: T): T {
  if (value == null || typeof value !== "object") return value;
  return ((value as { [RAW]?: T })[RAW] ?? value) as T;
}

/**
 * `signal` is the State holding the array, not its name — the name is only
 * looked up when a proxy is actually built, so a plain read costs nothing but
 * the isArray check and a WeakMap hit.
 */
export function guardArray<T>(value: T, signal: object): T {
  if (!Array.isArray(value)) return value;

  const existing = guarded.get(value);
  if (existing) return existing as T;

  const label = stateLabel(signal) ?? "an array in state";

  const proxy = new Proxy(value, {
    get(target, key, receiver) {
      if (key === RAW) return target;

      if (typeof key === "string" && ARRAY_MUTATORS.has(key)) {
        return (...args: unknown[]) => {
          diagnose(
            "RMD005",
            `${label}:${key}`,
            `\`${label}.${key}(…)\` mutated the array in place, so no signal fired and nothing re-rendered.`,
          );
          return (target[key as keyof unknown[]] as Function).apply(target, args);
        };
      }

      return Reflect.get(target, key, receiver);
    },

    set(target, key, next, receiver) {
      // `items[0] = x` and `items.length = 0` are mutations too.
      diagnose(
        "RMD005",
        `${label}:set`,
        `\`${label}[${String(key)}] = …\` mutated the array in place, so no signal fired and nothing re-rendered.`,
      );
      return Reflect.set(target, key, next, receiver);
    },
  });

  guarded.set(value, proxy);
  return proxy as T;
}
