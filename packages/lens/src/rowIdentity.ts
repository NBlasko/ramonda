/**
 * The marker a list uses to recognise a row, carried across a write.
 *
 * ## Why lens does this at all
 *
 * `list()` knows which row is which by the OBJECT. An update that replaces a row
 * — and every immutable update does — hands it an object it has never seen, so
 * the row is torn down and built again, taking whatever its component was
 * holding: a half-typed input, an open menu, a scroll position.
 *
 * Everything else has to GUESS which new object is which old row. A lens write
 * does not: at the moment it replaces a value it is holding both, so the answer
 * is known rather than inferred. That is the whole reason this is here and not
 * somewhere cleverer.
 *
 * ## Why a global symbol rather than an import
 *
 * The marker belongs to `@ramonda/core`, and lens does not depend on it — a lens
 * is a data tool and stands on its own. `Symbol.for` is how two packages can name
 * the same thing without one importing the other: with core present the marker
 * matches, and without it there is simply never one to carry.
 *
 * ## The one case it cannot carry
 *
 * A FROZEN value. Core keeps those markers off the object (there is nowhere to
 * put one), so there is nothing here to read — and the copy lens hands back is
 * not frozen, so the write after it carries normally. One edit, once.
 */
const ROW = Symbol.for("ramonda.row");

type Marked = { [ROW]?: string };

/** Gives `next` the row marker `previous` was carrying, if it had one. */
export function carryRow(previous: unknown, next: unknown): void {
  if (previous === null || typeof previous !== "object") return;
  if (next === null || typeof next !== "object") return;

  const id = (previous as Marked)[ROW];
  if (id === undefined) return;

  try {
    Object.defineProperty(next, ROW, { value: id, enumerable: false, configurable: true, writable: true });
  } catch {
    // `next` is frozen — the app froze what it handed back. Nothing to do: the
    // row simply keeps the identity it would have had without any of this.
  }
}
