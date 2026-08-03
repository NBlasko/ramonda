import { type Path, pathKey } from "./path";
import type { StandardIssue, StandardResult, StandardSchemaV1 } from "./types";

/** Messages by field, keyed with `pathKey` so two different paths cannot collide. */
export type Issues = ReadonlyMap<string, readonly string[]>;

export interface Validation<Out> {
  issues: Issues;
  /** The coerced values, present only when nothing failed. */
  value: Out | undefined;
}

/**
 * One shared empty map, for the state every form starts in and returns to.
 *
 * Safe to share because nothing ever writes into it: `collect` builds a new map, `withIssue`
 * copies before adding, and `forgetUnder` copies before deleting — so a form only ever
 * REPLACES its map, never mutates one. The `Issues` type is a `ReadonlyMap`, which is what
 * keeps that true without anyone having to remember it, and `Validation.test.tsx` mounts two
 * forms side by side to prove they cannot reach each other's messages.
 *
 * The same shape as `InfiniteQuery`'s `EMPTY`, and for the same reason: a fresh empty
 * container per read is an allocation on the hot path for a value nobody can change.
 */
export const NO_ISSUES: Issues = new Map();

/**
 * Runs a schema and files every message under the field it belongs to.
 *
 * Synchronous when the schema is: Standard Schema lets `validate` return either a result
 * or a promise, chosen per call, and bguard returns a promise only for a schema carrying
 * async validations. So a form over an ordinary schema never awaits, and never renders a
 * frame with last keystroke's errors.
 */
export function validate<S extends StandardSchemaV1>(
  schema: S,
  values: unknown,
): Validation<unknown> | Promise<Validation<unknown>> {
  const result = schema["~standard"].validate(values);
  return isPromise(result) ? result.then(collect) : collect(result);
}

function isPromise<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof (value as Promise<T>)?.then === "function";
}

function collect(result: StandardResult<unknown>): Validation<unknown> {
  if (result.issues === undefined) return { issues: NO_ISSUES, value: result.value };

  const issues = new Map<string, string[]>();
  for (const issue of result.issues) {
    const key = pathKey(issuePath(issue));
    const existing = issues.get(key);
    if (existing) {
      existing.push(issue.message);
    } else {
      issues.set(key, [issue.message]);
    }
  }

  return { issues, value: undefined };
}

/**
 * An issue's path as segments.
 *
 * The spec allows a segment to be either a key or `{ key }` — the object form is how a
 * validator attaches its own metadata to a segment — so both are unwrapped here rather
 * than at every read. A symbol key cannot address a form field and is rendered as its
 * description, which keeps the message visible instead of dropping it.
 */
export function issuePath(issue: StandardIssue): Path {
  if (!issue.path) return [];

  return issue.path.map((segment) => {
    const key = typeof segment === "object" ? segment.key : segment;
    if (typeof key === "number" || typeof key === "string") return key;
    return String(key.description ?? key.toString());
  });
}

/** Adds one message to a copy of the map — for `setError`, which does not re-run the schema. */
export function withIssue(issues: Issues, path: Path, message: string): Issues {
  const next = new Map(issues);
  const key = pathKey(path);
  next.set(key, [...(next.get(key) ?? []), message]);
  return next;
}
