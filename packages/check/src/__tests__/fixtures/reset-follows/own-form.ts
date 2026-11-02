/** A module's own `HTMLFormElement`: not the browser's, though it has the name. */
export interface HTMLFormElement {
  reset(): void;
}

declare const mine: HTMLFormElement;
declare const browsers: globalThis.HTMLFormElement;

export function clearMine() {
  mine.reset(); // ✗ form-retyped — a type a form fits, not the browser's form
}

export function notTheReset() {
  const { ...reset } = browsers; // ✓ the members a pattern leaves, taken by no name
  const each = browsers[Symbol.iterator]; // ✓ a symbol names no reset
  return [reset, each];
}
