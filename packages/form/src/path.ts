/**
 * A location inside the values, held as KEYS rather than as a string.
 *
 * A string path cannot be taken apart again reliably — a property name may contain a dot
 * or a bracket — so the array is the truth and the string is a rendering of it. bguard's
 * `ExceptionContext` carries both for the same reason.
 */
export type PathSegment = string | number;
export type Path = readonly PathSegment[];

/** The root, as one shared frozen array so every node does not allocate its own. */
export const ROOT: Path = Object.freeze([]);

/**
 * `address.street`, `contacts[2].value` — what a `name` attribute and an error key use.
 *
 * Numbers become brackets, so the string reads the way the schema does. The empty path is
 * the empty string, which is what a root-level error is filed under.
 */
export function pathToString(path: Path): string {
  let out = "";
  for (const segment of path) {
    if (typeof segment === "number") {
      out += `[${segment}]`;
    } else {
      out += out === "" ? segment : `.${segment}`;
    }
  }
  return out;
}

/**
 * Parses the string form back into keys, for `setError("contacts[0].value", …)`.
 *
 * Lossy where a key contains a dot or a bracket, which is exactly why nothing internal
 * uses this — it exists only at the edge where a caller hands over a written path, and a
 * caller who has such a key can reach the field through `fields.…$.at(key)` instead.
 */
export function parsePath(path: string): Path {
  if (path === "") return ROOT;

  const out: PathSegment[] = [];
  for (const part of path.split(".")) {
    let name = part;
    const bracket = name.indexOf("[");

    if (bracket !== -1) {
      name = part.slice(0, bracket);
      const indexes = part.slice(bracket).matchAll(/\[(\d+)\]/g);
      if (name !== "") out.push(name);
      for (const [, index] of indexes) out.push(Number(index));
      continue;
    }

    out.push(name);
  }
  return out;
}

/** Reads a location, answering `undefined` for anything the values do not reach. */
export function readAt(values: unknown, path: Path): unknown {
  let current = values;
  for (const segment of path) {
    if (current === null || current === undefined) return undefined;
    current = (current as Record<PathSegment, unknown>)[segment];
  }
  return current;
}

/**
 * Returns a copy of `values` with one location replaced, sharing everything it did not
 * have to touch.
 *
 * Copying rather than mutating is what makes a change VISIBLE: the values sit in `@state`,
 * and a signal compares by identity, so writing into the existing object would change what
 * a render reads without waking the render. The copy is one object per level of the path,
 * not one per field.
 *
 * A missing container is created from the NEXT segment's type — a number means an array —
 * so setting `contacts[0].kind` into empty values builds the shape rather than throwing.
 */
export function writeAt<T>(values: T, path: Path, next: unknown): T {
  if (path.length === 0) return next as T;

  const [head, ...rest] = path as PathSegment[];
  const key = head as PathSegment;
  const container = cloneContainer(values, key);
  const child = (container as Record<PathSegment, unknown>)[key];

  (container as Record<PathSegment, unknown>)[key] = rest.length === 0 ? next : writeAt(child, rest, next);

  return container as T;
}

/** A shallow copy of the right KIND, or a new one when there is nothing there yet. */
function cloneContainer(value: unknown, key: PathSegment): unknown {
  if (Array.isArray(value)) return [...value];
  if (value !== null && typeof value === "object") return { ...(value as object) };
  return typeof key === "number" ? [] : {};
}

/** Whether `path` is `prefix` or sits underneath it. */
export function startsWith(path: Path, prefix: Path): boolean {
  if (prefix.length > path.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (path[i] !== prefix[i]) return false;
  }
  return true;
}

/**
 * The segment separator inside a map key.
 *
 * NUL, because it is the one character a property name cannot carry: a schema key may well
 * contain a dot, a bracket or a space, and any of those would let two different paths share
 * a key. Written as an escape so it is visible in the source — a literal control character
 * here is invisible to a reader and to a diff.
 */
const SEPARATOR = "\u0000";

/**
 * A key for a Map, unambiguous where `pathToString` is not.
 *
 * `["a.b"]` and `["a", "b"]` render to the same string but must not share an entry, so the
 * key form keeps the segments apart and marks indexes with `#`.
 */
export function pathKey(path: Path): string {
  return path.map((segment) => (typeof segment === "number" ? `#${segment}` : segment)).join(SEPARATOR);
}

/** The prefix a descendant's key starts with. Exported so `covers` cannot drift from this. */
export function keyPrefix(path: Path): string {
  return path.length === 0 ? "" : `${pathKey(path)}${SEPARATOR}`;
}

/**
 * A child's key, built from its parent's — the same string `pathKey` would produce for its path.
 *
 * For a walk of the whole value, which is what a submit does. Building the path array per node and
 * running `pathKey` over it costs an allocation and a join each time. Kept here beside `pathKey` so the
 * two spellings of one format cannot drift — see `markKeys` in `Form.ts` for what the difference is
 * worth.
 *
 * `parentDepth` is what makes it exact rather than nearly. The root's key is the empty string, and so
 * is the key of a path whose only segment is an empty-string property name — `pathKey([])` and
 * `pathKey([""])` are both `""` — so a parent key alone cannot say which of the two it is, and the
 * child would come out unseparated. The depth answers it.
 */
export function childKey(parentKey: string, parentDepth: number, segment: PathSegment): string {
  const own = typeof segment === "number" ? `#${segment}` : segment;
  return parentDepth === 0 ? own : `${parentKey}${SEPARATOR}${own}`;
}

/**
 * The row number a key sits under, for a key somewhere beneath `prefix` — `undefined` if it is not
 * under an index at all.
 *
 * `rows #12 v` answers 12, and so does `rows #12`. For dropping what an array no longer has: a form that
 * once showed ten thousand rows kept a cached node and handle for every one of them.
 */
export function indexUnder(key: string, prefix: string): number | undefined {
  if (!key.startsWith(prefix)) return undefined;

  const end = key.indexOf(SEPARATOR, prefix.length);
  const segment = end === -1 ? key.slice(prefix.length) : key.slice(prefix.length, end);
  if (!segment.startsWith("#")) return undefined;

  const index = Number(segment.slice(1));
  return Number.isInteger(index) && index >= 0 ? index : undefined;
}
