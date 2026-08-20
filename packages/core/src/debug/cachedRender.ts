/**
 * DEV-only: which components have a CACHED `render`, so RMD020 can say it went blind.
 *
 * `@compute render()` and `@memoized render()` are allowed — forbidding them protected nobody, because a
 * `@compute` body returned from `render` does the same thing and was always legal. What they cost is this
 * check: it calls `render()` twice and compares, and a cache makes the two outputs one object, so an inline
 * handler, an object rebuilt in place and a non-deterministic read go unreported in the render itself. A
 * `list()` row is the exception and keeps its cover: `listEngine` builds each row twice on its own, so it
 * still reports a handler built per row even when the render around it is cached.
 *
 * ## An `info` line, not a warning, and not a diagnostic code
 *
 * Caching a render is a legitimate choice. A warning on a legitimate choice is how a codebase learns to
 * scroll past warnings, and an `RMD` code would put it in the list of faults to sweep for. So this is
 * stated on the log channel at `info`: it says what the check could not see, and asks for nothing.
 *
 * ## Why a mark and not an identity test
 *
 * Because identity has false positives, measured. Comparing the two outputs for sameness catches the cached
 * render — and also `render() { return this.props.children }` and `render() { return A_CONSTANT }`, which
 * are legitimate and hide nothing the parent did not already check:
 *
 * ```
 * a normal render with an inline handler   outputs differ
 * @compute render                          outputs SAME   <- the case to report
 * <div>{this.props.children}</div>         outputs differ
 * return this.props.children               outputs SAME   <- would be a false report
 * return A_MODULE_CONSTANT                 outputs SAME   <- would be a false report
 * ```
 *
 * The decorator, on the other hand, knows exactly. So the mark is set where the decision was made.
 *
 * ## What is deliberately NOT detected
 *
 * A `@compute` body returned from `render`. It is the same fault and it is invisible here: nothing at the
 * decoration site says the compute will be returned by the render, and at comparison time it is
 * indistinguishable from the two legitimate shapes above. Stated rather than guessed at.
 */
const cachedRenders = new WeakSet<object>();

/**
 * Said once per component, because a render runs on every commit.
 *
 * `diagnose` deduplicates for exactly this reason; this does not go through `diagnose` — see
 * `renderStability.ts` for why an `info` line rather than a warning — so the once-ness lives here.
 */
const announced = new WeakSet<object>();

/** Called by `@compute`/`@memoized` when the member they decorate is `render`. */
export function markCachedRender(instance: object): void {
  cachedRenders.add(instance);
}

export function hasCachedRender(instance: object): boolean {
  return cachedRenders.has(instance);
}

/** True the first time only, so the note appears once per component rather than once per commit. */
export function announceCachedRenderOnce(instance: object): boolean {
  if (!cachedRenders.has(instance) || announced.has(instance)) return false;
  announced.add(instance);
  return true;
}
