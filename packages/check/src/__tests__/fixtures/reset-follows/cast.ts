declare const forma: HTMLFormElement;

/** The other way to write an assertion — `.ts` only, where `<T>` is not a tag. */
export function castAway() {
  (<CanvasRenderingContext2D>(<unknown>forma)).reset(); // ✗ form-cast
  (<HTMLElement>forma).focus(); // ✓ the element it is
}
