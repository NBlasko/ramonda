import { describe, test, expect } from "vitest";
import { focusOn } from "../focus";

/**
 * Hidden data on a value, across an immutable edit.
 *
 * Something else attached a non-enumerable symbol to an object — that is how a
 * library marks a value without colliding with the fields, showing up in
 * `JSON.stringify`, or surviving a spread. A spread is exactly what a lens does
 * on every hop, so without this the mark dies on the first edit.
 *
 * The rule the whole file is about: an EDIT derives the new value from the old
 * and keeps the mark, a REPLACEMENT does not, and `set` is the only operation
 * that cannot tell which one it is being asked for.
 */

const MARK = Symbol("mark");
const OTHER = Symbol("other");
const VISIBLE = Symbol("visible");

function mark<T extends object>(value: T, key: symbol = MARK, id = "row-1"): T {
  Object.defineProperty(value, key, { value: id, enumerable: false, configurable: true });
  return value;
}

function makeRows(): { rows: { id: number; title: string; tags: string[] }[] } {
  return {
    rows: [mark({ id: 1, title: "first", tags: ["a"] }), mark({ id: 2, title: "second", tags: ["b"] }, MARK, "row-2")],
  };
}

describe("an edit carries hidden symbols", () => {
  test("merge keeps the mark — the row is being derived, not swapped", () => {
    const state = makeRows();

    const next = focusOn(state).get("rows").at(0).merge({ title: "edited" });

    expect(next.rows[0].title).toBe("edited");
    expect(next.rows[0]).not.toBe(state.rows[0]);
    expect((next.rows[0] as Record<symbol, unknown>)[MARK]).toBe("row-1");
  });

  test("update keeps it too, and the callback never sees it", () => {
    const state = makeRows();

    const next = focusOn(state)
      .get("rows")
      .at(1)
      .update((row) => ({ ...row, title: row.title.toUpperCase() }));

    // The spread inside the callback drops the mark, because that is what a
    // spread does. The lens puts it back on the way out.
    expect(next.rows[1].title).toBe("SECOND");
    expect((next.rows[1] as Record<symbol, unknown>)[MARK]).toBe("row-2");
  });

  test("a write aimed DEEPER keeps it — the row above the write is edited", () => {
    const state = makeRows();

    const next = focusOn(state).get("rows").at(0).get("title").set("deeper");

    expect(next.rows[0].title).toBe("deeper");
    // `set` landed on `title`. The row is a copy on the way to it, and a copy on
    // the way to something is a continuation of the row.
    expect((next.rows[0] as Record<symbol, unknown>)[MARK]).toBe("row-1");
  });

  test("the untouched sibling is the same object, mark and all", () => {
    const state = makeRows();

    const next = focusOn(state).get("rows").at(0).merge({ title: "edited" });

    expect(next.rows[1]).toBe(state.rows[1]);
  });

  test("a push does not fabricate a mark for the new element", () => {
    const state = makeRows();

    const next = focusOn(state).get("rows").push({ id: 3, title: "third", tags: [] });

    expect(Object.getOwnPropertySymbols(next.rows[2])).toEqual([]);
    expect((next.rows[0] as Record<symbol, unknown>)[MARK]).toBe("row-1");
  });

  test("a removal keeps nothing — there is no value left to continue", () => {
    const state = makeRows();

    const next = focusOn(state).get("rows").at(0).remove();

    expect(next.rows.map((row) => row.id)).toEqual([2]);
    // The row that MOVED into position 0 brought its own mark and not the
    // deleted row's.
    expect((next.rows[0] as Record<symbol, unknown>)[MARK]).toBe("row-2");
  });
});

describe("set replaces, and keeps nothing unless told", () => {
  test("by default the replacement arrives bare", () => {
    const state = makeRows();

    const next = focusOn(state).get("rows").at(0).set({ id: 99, title: "different", tags: [] });

    expect(next.rows[0].id).toBe(99);
    // This is the case the default is for: a genuinely different entity at
    // position 0. Carrying here would hand it the mark of the row it replaced.
    expect((next.rows[0] as Record<symbol, unknown>)[MARK]).toBeUndefined();
  });

  test("{ keepSymbols: true } says it is the same value rebuilt", () => {
    const state = makeRows();

    const next = focusOn(state)
      .get("rows")
      .at(0)
      .set({ id: 1, title: "rebuilt", tags: ["a"] }, { keepSymbols: true });

    expect(next.rows[0].title).toBe("rebuilt");
    expect((next.rows[0] as Record<symbol, unknown>)[MARK]).toBe("row-1");
  });

  test("a list of symbols keeps those and drops the rest", () => {
    const state = { rows: [mark(mark({ id: 1 }), OTHER, "other-1")] };

    const next = focusOn(state)
      .get("rows")
      .at(0)
      .set({ id: 1 }, { keepSymbols: [MARK] });

    expect((next.rows[0] as Record<symbol, unknown>)[MARK]).toBe("row-1");
    expect((next.rows[0] as Record<symbol, unknown>)[OTHER]).toBeUndefined();
  });

  test("a named symbol that is not there is not invented", () => {
    const state = { rows: [{ id: 1 }] };

    const next = focusOn(state)
      .get("rows")
      .at(0)
      .set({ id: 2 }, { keepSymbols: [MARK] });

    expect(Object.getOwnPropertySymbols(next.rows[0])).toEqual([]);
  });

  test("{ keepSymbols: false } is the default written out", () => {
    const state = makeRows();

    const next = focusOn(state).get("rows").at(0).set({ id: 1, title: "x", tags: [] }, { keepSymbols: false });

    expect((next.rows[0] as Record<symbol, unknown>)[MARK]).toBeUndefined();
  });

  test("asking to keep on a plain value is not an error", () => {
    const state = { rows: [{ id: 1 }] };

    const next = focusOn(state).get("rows").at(0).get("id").set(2, { keepSymbols: true });

    expect(next.rows[0].id).toBe(2);
  });

  test("an option on a deeper set does not reach back up the path", () => {
    const state = makeRows();

    // `title` is a string, so there is nothing to keep on it. The ROW above it
    // is still edited, so the row's mark survives regardless of the option.
    const next = focusOn(state).get("rows").at(0).get("title").set("x", { keepSymbols: false });

    expect((next.rows[0] as Record<symbol, unknown>)[MARK]).toBe("row-1");
  });

  test("a set with no change returns the original root untouched", () => {
    const state = makeRows();
    const row = state.rows[0];

    const next = focusOn(state).get("rows").at(0).set(row);

    expect(next).toBe(state);
    expect((next.rows[0] as Record<symbol, unknown>)[MARK]).toBe("row-1");
  });
});

describe("what counts as hidden", () => {
  test("an ENUMERABLE symbol is carried by the spread, not by this", () => {
    const value = { id: 1 };
    Object.defineProperty(value, VISIBLE, { value: "seen", enumerable: true, configurable: true });
    const state = { rows: [value] };

    const merged = focusOn(state).get("rows").at(0).merge({ id: 2 });
    expect((merged.rows[0] as Record<symbol, unknown>)[VISIBLE]).toBe("seen");

    // And `keepSymbols: true` does NOT resurrect it onto a replacement, because
    // the replacement is a different object and never had it.
    const replaced = focusOn(state).get("rows").at(0).set({ id: 3 }, { keepSymbols: true });
    expect((replaced.rows[0] as Record<symbol, unknown>)[VISIBLE]).toBeUndefined();
  });

  test("the carried property stays hidden — it does not leak into a copy or JSON", () => {
    const state = makeRows();

    const next = focusOn(state).get("rows").at(0).merge({ title: "edited" });
    const row = next.rows[0];

    expect(Object.keys(row)).toEqual(["id", "title", "tags"]);
    expect(JSON.stringify(row)).not.toContain("row-1");
    expect(Object.getOwnPropertySymbols({ ...row })).toEqual([]);
  });

  test("a frozen replacement refuses the mark and the edit still lands", () => {
    const state = makeRows();

    const frozen = Object.freeze({ id: 1, title: "frozen", tags: [] });
    const next = focusOn(state).get("rows").at(0).set(frozen, { keepSymbols: true });

    expect(next.rows[0].title).toBe("frozen");
    // Nothing can be attached to a frozen object, and that is the caller's
    // choice rather than an error.
    expect((next.rows[0] as Record<symbol, unknown>)[MARK]).toBeUndefined();
  });

  test("a nested object below the write is copied without gaining anything", () => {
    const state = makeRows();

    const next = focusOn(state).get("rows").at(0).get("tags").push("z");

    expect(next.rows[0].tags).toEqual(["a", "z"]);
    expect(Object.getOwnPropertySymbols(next.rows[0].tags)).toEqual([]);
    expect((next.rows[0] as Record<symbol, unknown>)[MARK]).toBe("row-1");
  });
});
