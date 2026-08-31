/** Module scope in ANOTHER file: built once when the module loads, and the documented fix. */
export const arrowHandler = () => {};

/** A call that BUILDS one. Not followed — see the rule's note on `@memoized` and `debounce`. */
export function makeHandler(): () => void {
  return () => {};
}

const HELD = () => {};

/** A call that hands back one it HOLDS. Stable, and silent for the same reason. */
export function heldHandler(): () => void {
  return HELD;
}

/** Mutual recursion, for the cycle guard. */
export function loopHandler(): () => void {
  return otherLoop();
}

export function otherLoop(): () => void {
  return loopHandler();
}
