import { reportRefBuiltInAPurePhase } from "../debug/purityGuard";

export type RefCallback<T> = (current: T | null) => void;

/**
 * What a JSX `ref` prop accepts: anything that can RECEIVE this element.
 *
 * Not `Ref<T>` with the exact element type. `Ref<T>` holds a mutable `current`,
 * so it is invariant — `createRef<HTMLElement>()` was rejected on a `<p>`,
 * because `Ref<HTMLElement>` is not a `Ref<HTMLParagraphElement>`. Asking only
 * for the setter makes the wide ref fit the narrow element, which is the way
 * round that is actually safe: it can hold anything the element might be.
 */
export interface RefTarget<T> {
  setCurrent(current: T | null): void;
}

export class Ref<T = unknown> {
  public current: T | null = null;

  constructor(private readonly cb?: RefCallback<T>) {}

  public setCurrent(current: T | null): void {
    if (this.current === current) return;
    this.current = current;
    this.cb?.(current);
  }
}

/**
 * Makes a ref, and refuses to be a good place to do it from.
 *
 * A ref is an IDENTITY: the caller keeps it and reads `current` later. So it belongs where an
 * identity belongs — a field, or anywhere that runs once. Called from a render, a `@compute`, a
 * `@memoized` member or a hook's props callback, it is a new object every time: the child is handed
 * a changed `ref` on every parent render, which is a props change (see `helpers/arePropsBagsEqual.ts`)
 * and costs a render for nothing, and the ref the author meant to read is replaced before they can.
 *
 * Reported rather than refused, because throwing would take down a page over something that still
 * renders correctly. `@ramonda/check`'s `ref-built-where-it-cannot-be-kept` says the same thing
 * before it runs.
 */
export function createRef<T>(cb?: RefCallback<T>) {
  if (__DEV__) reportRefBuiltInAPurePhase();
  return new Ref<T>(cb);
}
