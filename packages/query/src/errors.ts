/**
 * A failure, reduced to what can cross the server→client boundary.
 *
 * An `Error` does not survive JSON: `JSON.stringify(new Error("nope"))` is `{}`,
 * because `name`, `message` and `stack` are all non-enumerable. Core already
 * warns about exactly this when a component puts one in `@state`
 * (hydration/serialize.ts), and `AsyncLoad` works around it by keeping its
 * `failure` OFF `@state` and only flagging `hasError` — the failure never needed
 * to travel there, because a client that failed to load a chunk has its own error.
 *
 * A query's error DOES need to travel: the server tried to fetch, it failed, and
 * the page has to render the failure rather than a spinner that never resolves.
 * So it travels as this — the two fields a UI actually renders.
 */
export interface SerializedError {
  name: string;
  message: string;
}

/**
 * What a restored error is when it reaches the client.
 *
 * A real `Error` subclass rather than the plain `{ name, message }` object,
 * because app code writes `error.message` and `error instanceof Error` and both
 * must keep working after hydration. The class is exported so a boundary that
 * wants to tell "this failed on the server" from "this failed here" can ask.
 *
 * `stack` is not carried over. It would point into the server's bundle, which no
 * client-side source map can resolve — a stack that leads nowhere is worse than
 * an honest absence, and it is a chunk of the response body per failed query.
 */
export class ServerQueryError extends Error {
  constructor(error: SerializedError) {
    super(error.message);
    this.name = error.name;
    // The prototype has to be restored explicitly when subclassing a builtin,
    // or `instanceof ServerQueryError` is false on a target below ES2015.
    Object.setPrototypeOf(this, ServerQueryError.prototype);
  }
}

/**
 * Whatever was thrown, as an `Error` — the one place a rejection is normalised.
 *
 * A fetcher is app code and rejects with what it likes: `throw "not found"` after a validation, a
 * status number, a plain object parsed out of a JSON error body, or `undefined` from a bare `throw`.
 * Measured, every one of those reached `query.error` exactly as thrown, which is why `error` used to
 * be `unknown` and why every example wrote `(error as Error).message` — a read that is `undefined`
 * for three of those four shapes, so the page rendered an empty failure.
 *
 * Two things made a type alone insufficient. Saying "it is an `Error`" without making it one turns a
 * visible cast into an invisible `undefined`. And the two halves of a page already disagreed: a
 * failure restored from the server came back as `ServerQueryError`, a real `Error`, while the same
 * failure fetched on the client came back as whatever was thrown — so identical app code behaved
 * differently depending on whether the page was server-rendered.
 *
 * An `Error` is passed through as ITSELF rather than wrapped: wrapping would break
 * `instanceof MyApiError` in an app that throws its own subclass, and put what the reader wants one
 * `cause` deeper for nothing. Everything else keeps the original on `cause`, which is where a retry
 * policy that inspects a thrown object reaches for it.
 */
export function asError(thrown: unknown): Error {
  if (thrown instanceof Error) return thrown;
  // `String(thrown)` rather than a stringify: an object with a `toString` says what it means, one
  // without says `[object Object]`, and a stringify can throw on a cycle — which is the last thing a
  // failing request needs.
  return new Error(String(thrown), { cause: thrown });
}

/** Reduces anything a fetcher can reject with to the serializable shape. */
export function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }

  // A rejected string, a rejected object, `undefined` from a bare `throw` — all
  // reachable, none of them an Error. Named "Error" rather than the typeof so the
  // client renders something a reader recognises.
  return { name: "Error", message: typeof error === "string" ? error : String(error) };
}

/** Rebuilds a throwable from a snapshot. */
export function deserializeError(error: SerializedError): ServerQueryError {
  return new ServerQueryError(error);
}
