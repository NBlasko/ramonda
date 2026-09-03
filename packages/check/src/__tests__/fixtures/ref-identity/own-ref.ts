/** An app's own `createRef`, judged by nobody's semantics but its own. */
export function createRef<T>(): { current: T | null } {
  return { current: null };
}
