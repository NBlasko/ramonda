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

export function createRef<T>(cb?: RefCallback<T>) {
  return new Ref<T>(cb);
}
