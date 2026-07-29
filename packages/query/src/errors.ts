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
