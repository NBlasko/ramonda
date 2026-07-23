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
