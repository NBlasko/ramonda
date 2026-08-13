/**
 * Hidden data attached to a value, carried across an edit of that value.
 *
 * ## What counts as hidden
 *
 * An own property under a SYMBOL, and not enumerable. Both halves matter. A
 * symbol is how a library attaches something to your object without colliding
 * with your fields or showing up in `JSON.stringify`; non-enumerable is how it
 * stays out of `Object.keys`, `for…in` — and out of a spread, which is the whole
 * reason this exists. `{ ...value }` copies enumerable symbols already, so those
 * were never at risk. It is the hidden ones that a copy loses.
 *
 * ## Why a lens carries them
 *
 * An immutable edit means the value you get back is a NEW object, and anything
 * attached to the old one is gone with it. That is right when you REPLACED the
 * value and wrong when you EDITED it: an edit produces a new version of the same
 * thing, and whatever was attached to it describes that thing rather than that
 * object.
 *
 * `merge`, `update`, and a write aimed deeper than the value all edit — they
 * derive the new version from the old, so this runs. A `set` aimed at the value
 * itself replaces, so it does not, and says so where it is written:
 *
 * ```ts
 * focusOn(items).at(0).merge({ title })                   // edit — kept
 * focusOn(items).at(0).set(other)                         // replace — not kept
 * focusOn(items).at(0).set(same, { keepSymbols: true })   // replace, but the same thing
 * ```
 *
 * A lens does not know what the hidden data means and does not need to. It knows
 * that an edit is a continuation and a replacement is not.
 */

/** What to keep: everything hidden, nothing, or exactly these. */
export type KeepSymbols = boolean | readonly symbol[];

export function keepSymbols(previous: unknown, next: unknown, what: KeepSymbols): void {
  if (what === false) return;
  if (previous === null || typeof previous !== "object") return;
  if (next === null || typeof next !== "object") return;

  if (what === true) {
    for (const key of Object.getOwnPropertySymbols(previous)) {
      const descriptor = Object.getOwnPropertyDescriptor(previous, key);
      // Enumerable ones a spread already carried; copying them again would be
      // work for nothing, and would also resurrect one the edit meant to drop.
      if (descriptor === undefined || descriptor.enumerable) continue;
      define(next, key, descriptor);
    }
    return;
  }

  for (const key of what) {
    const descriptor = Object.getOwnPropertyDescriptor(previous, key);
    if (descriptor === undefined) continue;
    define(next, key, descriptor);
  }
}

function define(target: object, key: symbol, descriptor: PropertyDescriptor): void {
  try {
    Object.defineProperty(target, key, descriptor);
  } catch {
    // `next` is frozen — the caller froze what they handed back. Nothing to do:
    // the value keeps whatever it would have had without any of this.
  }
}
