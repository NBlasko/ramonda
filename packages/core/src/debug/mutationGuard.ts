import { diagnose } from "./diagnostics";
import { stateLabel } from "./stateLabels";

/**
 * DEV-only guard for the values a signal holds, so a change made IN PLACE is
 * reported instead of silently doing nothing.
 *
 * `this.items.push(x)` and `this.user.name = "x"` both mutate the value the
 * signal is already holding. The setter never runs, so nothing re-renders and the
 * framework looks broken. The guard hands out a proxy that reports the change.
 *
 * ## Lazily, along the path that is read
 *
 * The guard does NOT walk the value. A `get` returns a guarded child only when
 * something asks for that child, so the proxy tree materialises along the path a
 * render actually touches and nowhere else — the same shape as a lens write,
 * which rebuilds the path it changes and shares the rest. A component that reads
 * `user.name` pays for two proxies whatever the size of `user`.
 *
 * ## Identity
 *
 * One proxy per object, kept in a WeakMap. Identity has to stay stable:
 * `this.user` returning a fresh proxy on each read would break every `===` the
 * diff and `@ShouldUpdateOnPropsChange` rely on, and the guard would turn every
 * render into a change.
 *
 * ## What is left alone
 *
 * Only plain objects and arrays are wrapped. A `Date`, a `Map`, a class instance
 * or anything with a prototype of its own goes through untouched: their methods
 * need the real receiver, and a proxy would break them for a report nobody asked
 * for. Non-mutating array reads (`map`, `filter`, `slice`, iteration, `length`)
 * pass through, and `slice()`/spread return plain arrays — so copy-then-reassign
 * is untouched.
 */

const ARRAY_MUTATORS = new Set(["push", "pop", "shift", "unshift", "splice", "sort", "reverse", "fill", "copyWithin"]);

/** Reads back the value behind a guard proxy; absent on everything else. */
const RAW = Symbol("ramondaRaw");

/** One proxy per guarded value — see "Identity" above. */
const guarded = new WeakMap<object, object>();

/** Everything a guard proxy needs to describe itself, without re-deriving the label per access. */
interface GuardContext {
  label: string;
  /** The path from the state field to this value: `user.address`. */
  path: string;
}

/** Unwraps a guard proxy back to the plain value, if it is one. */
export function unwrapArray<T>(value: T): T {
  if (value == null || typeof value !== "object") return value;
  return ((value as { [RAW]?: T })[RAW] ?? value) as T;
}

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Whether this value is worth wrapping at all. */
function guardable(value: unknown): value is object {
  if (value === null || typeof value !== "object") return false;
  return Array.isArray(value) || isPlainObject(value);
}

function guard<T>(value: T, context: GuardContext): T {
  if (!guardable(value)) return value;

  /**
   * Already a guard proxy — hand it back rather than wrapping it again.
   *
   * Proxies escape into user code the moment anything copies: `[...this.rows]`
   * spreads guarded children into a new array, and the setter unwraps only the
   * array it is given, so the state ends up HOLDING proxies. Reading them back
   * would then wrap a proxy in a proxy, and the new one has an identity nothing
   * has seen — every list row looks new on every pass, and the reconciler moves
   * every node. Measured before this check: a no-op render moved 200 of 200 nodes.
   */
  if ((value as { [RAW]?: unknown })[RAW] !== undefined) return value;

  const existing = guarded.get(value);
  if (existing) return existing as T;

  const proxy = Array.isArray(value) ? arrayProxy(value, context) : objectProxy(value as object, context);

  guarded.set(value, proxy);
  return proxy as T;
}

/** `user.address` for a nested read, `user` for the field itself. */
function childContext(context: GuardContext, key: string): GuardContext {
  return { label: context.label, path: `${context.path}.${key}` };
}

function objectProxy(value: object, context: GuardContext): object {
  return new Proxy(value, {
    get(target, key, receiver) {
      if (key === RAW) return target;
      const read = Reflect.get(target, key, receiver);
      // Lazily, and only for a key that names something: a symbol read is
      // machinery (iterators, `toStringTag`) and never the path a mutation takes.
      if (typeof key !== "string") return read;
      return guard(read, childContext(context, key));
    },

    set(target, key, next, receiver) {
      diagnose(
        "RMD034",
        `${context.label}:${context.path}.${String(key)}`,
        `\`${context.path}.${String(key)} = …\` changed the object in place, so no signal fired and nothing re-rendered.`,
      );
      return Reflect.set(target, key, next, receiver);
    },

    deleteProperty(target, key) {
      diagnose(
        "RMD034",
        `${context.label}:${context.path}.${String(key)}:delete`,
        `\`delete ${context.path}.${String(key)}\` changed the object in place, so no signal fired and nothing re-rendered.`,
      );
      return Reflect.deleteProperty(target, key);
    },
  });
}

function arrayProxy(value: unknown[], context: GuardContext): object {
  return new Proxy(value, {
    get(target, key, receiver) {
      if (key === RAW) return target;

      if (typeof key === "string" && ARRAY_MUTATORS.has(key)) {
        return (...args: unknown[]) => {
          diagnose(
            "RMD005",
            `${context.label}:${key}`,
            `\`${context.path}.${key}(…)\` mutated the array in place, so no signal fired and nothing re-rendered.`,
          );
          return (target[key as keyof unknown[]] as (...a: unknown[]) => unknown).apply(target, args);
        };
      }

      const read = Reflect.get(target, key, receiver);
      // An index or a named property; the rest (`length`, symbols, methods) is
      // returned as it is.
      if (typeof key !== "string") return read;
      return guard(read, childContext(context, key));
    },

    set(target, key, next, receiver) {
      // `items[0] = x` and `items.length = 0` are mutations too.
      diagnose(
        "RMD005",
        `${context.label}:set`,
        `\`${context.path}[${String(key)}] = …\` mutated the array in place, so no signal fired and nothing re-rendered.`,
      );
      return Reflect.set(target, key, next, receiver);
    },
  });
}

/**
 * `signal` is the State holding the value, not its name — the name is only looked
 * up when a proxy is actually built, so a plain read costs the guardable check and
 * a WeakMap hit.
 */
export function guardArray<T>(value: T, signal: object): T {
  if (!guardable(value)) return value;
  const existing = guarded.get(value);
  if (existing) return existing as T;

  const label = stateLabel(signal) ?? (Array.isArray(value) ? "an array in state" : "an object in state");
  return guard(value, { label, path: label });
}
