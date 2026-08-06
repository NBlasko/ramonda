/**
 * Shallow copies for the nodes on the path — the only nodes that ever get
 * copied.
 *
 * Everything off the path keeps its identity, which is the entire point: a
 * consumer doing a shallow compare (Ramonda's diff, a memo, a store subscriber)
 * can reject an untouched branch on a `===` and never look inside it.
 */

export function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

/** Anything a path can descend into: an object or an array, but not `null`. */
export function isContainer(value: unknown): value is object {
  return value !== null && typeof value === "object";
}

/**
 * Keys a write is never allowed to land on.
 *
 * `get(key)` takes a `string | number`, so the key can come from data — a form
 * field name, a key off a parsed request body — and every write ends in
 * `copy[key] = value`. For `__proto__` that assignment does not create a
 * property at all: it runs the setter `Object.prototype` provides and swaps the
 * copy's prototype, which is a change at a place no path named. `constructor`
 * and `prototype` are refused with it — a write through either targets an
 * object's machinery rather than its data, and no legitimate path needs to.
 *
 * Checked in production too, not only under `__DEV__`. A guard that runs only
 * where the diagnostics run protects the one build that was never at risk.
 *
 * Three comparisons rather than a `Set`, because this sits on the per-hop path
 * and the strings are literals the engine has already interned.
 */
export function isUnsafeKey(key: string): boolean {
  return key === "__proto__" || key === "constructor" || key === "prototype";
}

/**
 * Copies one node, preserving its prototype.
 *
 * A spread would silently turn a class instance into a plain object, and the
 * failure surfaces far away — a method call on a value that came out of an
 * update three modules later. Descriptors are copied rather than assigned so
 * getters stay getters instead of being frozen into their current value.
 */
export function shallowClone<T extends object>(node: T): T {
  if (isArray(node)) return node.slice() as unknown as T;

  const proto: object | null = Object.getPrototypeOf(node) as object | null;
  if (proto === Object.prototype) return { ...node };

  return Object.create(proto, Object.getOwnPropertyDescriptors(node)) as T;
}

/**
 * Containers whose contents live in internal slots that a descriptor copy cannot
 * reach. Cloning one produces an object that looks right and throws on first
 * use, so a path that tries to descend into one is reported instead.
 *
 * They are fine as VALUES — `set(new Date())` stores a Date like any other leaf.
 * Only traversing INTO one is unsupported.
 */
export function exoticName(node: object): string | undefined {
  if (node instanceof Map) return "Map";
  if (node instanceof Set) return "Set";
  if (node instanceof Date) return "Date";
  if (node instanceof WeakMap) return "WeakMap";
  if (node instanceof WeakSet) return "WeakSet";
  return undefined;
}
