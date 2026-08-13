import type { KeepSymbols } from "./keepSymbols";

/** The element type of an array, and `never` for anything that is not one. */
export type ElementOf<T> = T extends readonly (infer E)[] ? E : never;

/**
 * A path under construction.
 *
 * The array methods are present only when the focused value IS an array, so
 * `.where()` on an object is "Property 'where' does not exist" at the call site
 * rather than a runtime miss. `[…]` is wrapped to stop the conditional
 * distributing over a union: `Post[] | null` should offer array methods on the
 * whole thing or none of it, not resolve per member.
 *
 * `NonNullable` throughout, because a path steps THROUGH a nullable value rather
 * than being stopped by one. `keyof ({ name: string } | null)` is `never`, so
 * without it a single optional property in the middle of a path makes every hop
 * below it unreachable — while at runtime it is simply a miss that reports
 * itself and changes nothing.
 */
export type Focus<Root, Current> = FocusCommon<Root, Current> &
  ([NonNullable<Current>] extends [readonly unknown[]] ? FocusArray<Root, ElementOf<NonNullable<Current>>> : unknown);

export interface FocusCommon<Root, Current> {
  /** Descends into a property. */
  get<K extends keyof NonNullable<Current> & (string | number)>(key: K): Focus<Root, NonNullable<Current>[K]>;

  /**
   * Replaces the focused value and returns the new root.
   *
   * A value that is already `Object.is`-equal to the current one produces NO
   * copies at all and returns the original root, identity intact — so a
   * consumer comparing with `===` sees nothing changed, because nothing did.
   *
   * **Hidden data on the old value is NOT carried over.** `set` is handed a
   * value rather than deriving one, so it cannot know whether the new value
   * continues the old — and treating a replacement as a continuation is how a
   * different thing inherits what was attached to the one it replaced. `merge`
   * and `update` derive, so they carry; say it here when you know:
   *
   * ```ts
   * focusOn(items).at(0).set(other)                          // a different value
   * focusOn(items).at(0).set(rebuilt, { keepSymbols: true }) // the same one, rebuilt
   * ```
   *
   * See `KeepSymbols`.
   */
  set(value: Current, options?: { keepSymbols?: KeepSymbols }): Root;

  /** Replaces the focused value with the result of `updater`. */
  update(updater: (value: Current) => Current): Root;

  /** Copies the focused object and assigns `partial` over it. */
  merge(partial: [NonNullable<Current>] extends [object] ? Partial<NonNullable<Current>> : never): Root;

  /**
   * Removes the focused value from its container: a property from an object, an
   * element from an array. With `where`, removes every match in one pass.
   */
  remove(): Root;

  /**
   * Forks the path here: each branch walks on from THIS value and returns the
   * new version of it. Returns the new root, like any other write.
   *
   * ```ts
   * focusOn(state)
   *   .get("posts")
   *   .where((post) => post.id === 102)
   *   .and(
   *     (post) => post.get("title").set("Renamed"),
   *     (post) => post.get("tags").push("published"),
   *   );
   * ```
   *
   * **Everything above the fork is copied once, not once per branch** — which is
   * the reason this exists rather than calling `focusOn` again on each result.
   * The shared prefix is walked a single time.
   *
   * Branches run in order and each sees the previous one's result, so two
   * branches may touch the same value without one silently winning.
   *
   * A branch receives a focus rooted at the forked value, so its `Root` IS
   * `Current` — which is why a branch's terminal operation type-checks as the
   * value it has to return. Each branch is its own chain, so each does one
   * write; fork again for more.
   *
   * For several fields of the SAME object, `merge` is shorter. Reach for this
   * when the branches go to different depths, or need different operations.
   */
  and(...branches: Array<(focus: Focus<Current, Current>) => Current>): Root;

  /** The first focused value, or `undefined` if the path resolves to nothing. */
  value(): Current | undefined;

  /** Every focused value. Empty when the path resolves to nothing. */
  values(): Current[];
}

export interface FocusArray<Root, E> {
  /** Descends into one element by position. Negative counts from the end. */
  at(index: number): Focus<Root, E>;

  /**
   * Descends into EVERY element the predicate accepts.
   *
   * A write through a multi-match path edits all of them in one walk, and the
   * array it lives in is copied exactly once no matter how many matched.
   *
   * Narrowing is EXPLICIT — `where<Circle>(s => s.kind === "circle")` — and
   * never inferred from the predicate. An overload taking a `value is S` guard
   * looks like the obvious design and is a trap: since TypeScript 5.5 a plain
   * arrow gets a type predicate inferred for it, so `where(tag => tag === "js")`
   * on a `string[]` silently focused the literal type `"js"`, and the natural
   * next line — `.set("ts")` — failed with "'ts' is not assignable to '\"js\"'".
   * The narrowing nobody asked for broke the write it was supposed to serve.
   */
  where<S extends E = E>(predicate: (value: E, index: number) => boolean): Focus<Root, S>;

  /** Appends to the focused array. */
  push(...items: E[]): Root;

  /** Inserts at a position. `index === length` appends; negative counts from the end. */
  insert(index: number, ...items: E[]): Root;
}
