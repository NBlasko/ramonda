import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { getDOM } from "../test/setup";
import { Component, list, state } from "../index";
import { State } from "../reactivity/State";
import { stampIdentity } from "../helpers/itemIdentity";

/**
 * Two items under one identity, and the scope one of them leaves behind.
 *
 * Each item gets a reactive scope, stored under its key. When two items produce
 * the SAME key, the second one's scope overwrites the first in the map being
 * built for this pass — but the first had already subscribed to everything its
 * mapper read. It was then in neither map: not in the previous pass's scopes,
 * and no longer in this pass's, so the cleanup loop at the end of the build,
 * which detaches exactly the scopes that did not carry over, never saw it.
 *
 * A live subscription with no owner. Every change to a signal that shadowed
 * mapper had read went on calling `host.reBuild()` for the life of the page,
 * re-rendering the list's owner for an item that no longer exists — and marking
 * the engine dirty, which defeats the whole-list skip along the way.
 *
 * There is no longer a way to ASK for this. Identity is minted from a
 * process-wide counter and carried on the item, so two items cannot answer the
 * same thing through any API — the `key` callback that could is gone. So the
 * collision is forced here, by stamping one item with another's identity.
 *
 * The guard is kept, and tested, because the cost of being wrong is a listener
 * that is never detached and an engine that is permanently dirty — and because
 * identity now travels between lists, which is a great deal more surface than
 * "one region mints its own ids" ever had.
 *
 * The signal is a raw `State` rather than the component's own `@state` on
 * purpose: a component subscribes its own state at construction, so writing to it
 * re-renders the owner whatever the list does, and the test would prove nothing.
 */
describe("a list with two items under one key", () => {
  beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  test("does not leave the shadowed item's scope subscribed", async () => {
    const hidden = new State(0);
    let ownerRenders = 0;

    type Row = { id: number };

    // Forced: both items carry the identity `f-same`, so the second's scope
    // lands on the first's key and shadows it. Nothing an app can write does
    // this — see the note above.
    const rows: Row[] = [{ id: 1 }, { id: 2 }];
    for (const row of rows) stampIdentity(row, "f-same");

    class L extends Component {
      @state rows: Row[] = rows;

      render() {
        ownerRenders++;
        return (
          <ul>
            {list(this.rows, (r: Row) => {
              // Only the FIRST item reads it, and the first item is the one whose
              // scope gets shadowed.
              if (r.id === 1) hidden.get();
              return <li>{r.id}</li>;
            })}
          </ul>
        );
      }
    }

    const app = await getDOM<L>(<L />);
    await app.settle();

    ownerRenders = 0;
    hidden.set(1);
    await app.settle();

    expect(ownerRenders).toBe(0);

    // And it stays gone, rather than being detached by the next pass.
    hidden.set(2);
    await app.settle();
    expect(ownerRenders).toBe(0);
  });

  test("a signal the surviving item reads still re-renders the list", async () => {
    const watched = new State(0);
    let ownerRenders = 0;

    type Row = { id: number };

    class L extends Component {
      @state rows: Row[] = [{ id: 1 }, { id: 2 }];

      render() {
        ownerRenders++;
        return (
          <ul>
            {list(this.rows, (r: Row) => {
              if (r.id === 2) watched.get();
              return <li>{r.id}</li>;
            })}
          </ul>
        );
      }
    }

    const app = await getDOM<L>(<L />);
    await app.settle();

    // The control: with distinct keys nothing is shadowed, and the item's
    // subscription is live — so the release above must not be a blanket detach.
    ownerRenders = 0;
    watched.set(1);
    await app.settle();

    expect(ownerRenders).toBe(1);
  });
});
