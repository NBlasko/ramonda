/**
 * A failure, as text, for anything that can be thrown or rejected with.
 *
 * `error` is `unknown` wherever the framework hands one over, and not out of caution: `throw "gone"`,
 * a rejected string, a rejected plain object and a bare `throw` are all reachable. So
 * `(error as Error).message` is `undefined` — and a page written that way renders an empty failure
 * exactly when there is something to say. Measured on a query rejecting with a string, a number and a
 * plain object: three of the four shapes showed nothing at all.
 *
 * `String(error)` rather than `JSON.stringify`: an object with a `toString` says what it means, and
 * one without says `[object Object]`, which is at least visible. A stringify can throw on a cycle,
 * and a failure handler that throws is the last thing a failing page needs.
 */
export function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
