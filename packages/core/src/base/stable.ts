import { STABLE } from "../helpers/constants";

/**
 * Keeps an array or object literal in a hook's props at ONE identity for as long as its
 * contents are equal.
 *
 * ```tsx
 * private user = this.use(Query, (self: UserCard) => ({
 *   key: stable(["user", self.props.id]),   // the same array until `id` moves
 *   fetch: self.load,                        // a bound method is already stable
 * }));
 * ```
 *
 * ## Why this exists, and why it is the counterpart of `list()`
 *
 * The props callback runs on every render of the owner — that is its contract, and what
 * keeps a hook in step. So an array literal in it is a new array every render, and every
 * prop is a signal: a new reference is a change, so a `@compute` reading it recomputes,
 * a `@watchProp` on it fires, and a subscription whose `connect` reads it reconnects.
 * Measured in core's tests: a compute reading a rebuilt array runs 3 times across 3
 * renders where one reading a scalar prop runs once.
 *
 * `render()` had the same problem and got two answers — `@memoizedHandler` for functions
 * and `list()` for mapped children — so that writing the natural thing is also the
 * efficient thing. This is the third: you declare the parts, the framework owns the
 * identity. Rebuilding is reported by [RMD022], and this is the fix it names.
 *
 * ## What it does and does not cover
 *
 * Resolved for values placed **directly** in the bag; a marker nested inside another
 * object or array is not looked for, because the walk would then run over the whole bag
 * on every render for a case that has never come up.
 *
 * Contents are compared to a bounded depth (`valueEqual`), so a deeply nested literal
 * gets a fresh reference rather than a wrong one — the safe direction.
 *
 * **Functions cannot go here.** Two closures with the same body are not equal by any
 * comparison that is safe to make, so a function keeps its own answers: a bound method
 * (`fetch: self.load`, which reads `this` when called, so there is nothing to capture),
 * or `@memoizedHandler` when it has to be built per argument.
 *
 * The returned value is typed as what you passed, and it *is* that value by the time the
 * hook reads it — the wrapper exists only between the callback returning and the props
 * being applied. Calling `stable()` anywhere else hands back a wrapper nothing will
 * unwrap, exactly like using a `list()` descriptor outside children.
 */
export function stable<T extends readonly unknown[] | Record<string, unknown>>(value: T): T {
  return { [STABLE]: value } as unknown as T;
}
