/**
 * The KEY a class name carries — what its declaration sets — read back out of the name.
 *
 * **Its own module because both halves need it and neither may import the other.** The compiler
 * WRITES the key, in `compiler/names.ts`, which reaches for `node:crypto`; the runtime READS it, in
 * `merge.ts`, which ships to a browser. A second copy is the shape this repository keeps finding,
 * where two halves of one answer drift the first time either is corrected — and here a drift would
 * mean a merge deciding something the class name did not say.
 */

/**
 * Everything between `r-` and the first `-` after it.
 *
 * The key may hold no `-` — that is what the encodings in `keyToken` are protecting — so the first
 * one is always the boundary, wherever the value holds `-` of its own (`-4px`, `sans-serif`, `a-b`).
 * A name with no second `-` at all is the whole of it, which is what a hashed key with no value
 * beside it looks like.
 */
export function keyIn(className: string): string {
  const end = className.indexOf("-", 2);
  return end === -1 ? className.slice(2) : className.slice(2, end);
}

/**
 * A key split into the context it sits in and the property it sets.
 *
 * The LAST `.`, because a context may hold one — `_.title.c` is `& .title` setting `color` — and a
 * property may not. A key with no `.` has no context, and a key that is hashed whole has no
 * readable property either; both come back with an empty context, which is the honest answer for
 * the second and the true one for the first.
 */
export function partsOf(key: string): { context: string; property: string } {
  const at = key.lastIndexOf(".");
  return at === -1 ? { context: "", property: key } : { context: key.slice(0, at + 1), property: key.slice(at + 1) };
}
