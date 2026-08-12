import { describe, test, expect, beforeEach } from "vitest";
import { getDOM } from "../test/setup";
import { Component, Host, list, state } from "../index";
import { mounted } from "../base/decorators";

/**
 * Identity across a REFETCH — the one case that still asked for a `key`.
 *
 * `list()` mints identity from the item, and for an object that means its
 * reference. An update that keeps the references of what it did not change
 * therefore keeps every untouched row exactly as it was, which is the common
 * case and has always worked.
 *
 * Data that arrives from OUTSIDE cannot do that. A refetch, a `JSON.parse`, a
 * deserialize — every row is a fresh object meaning the same entity as before,
 * and matching by reference finds nothing, so the whole list was rebuilt: new
 * DOM nodes, and every per-row component destroyed and created again with its
 * state gone. `key: (item) => item.id` existed for exactly this.
 *
 * So identity falls back to VALUE when the reference misses. What that buys is
 * continuity — the same id, the same scope, the same DOM node, the same
 * component instance — and deliberately NOT the skip: a value-matched item is a
 * different object, so its mapper runs again and whatever changed is rendered.
 * The comparison is bounded (see `valueEqual`), which is right for deciding
 * WHICH entity this is and would be wrong for deciding that nothing changed.
 */

interface Row {
  id: number;
  t: string;
  /**
   * A flag every row shares — and the reason this is here.
   *
   * Without it these tests could not see the hole they now cover: a pair used to
   * be made whenever two rows still agreed on ANY field, and rows of real data
   * agree on their flags and enums all the time (`done`, `status`, `type`). A
   * fixture whose rows shared nothing passed while page 2 of a real table was
   * quietly inheriting page 1's rows.
   */
  done: boolean;
}

let mapperCalls = 0;
let rowMounts = 0;

beforeEach(() => {
  mapperCalls = 0;
  rowMounts = 0;
});

/** A row that can prove it was not re-created: its state only survives if it did. */
class RowView extends Component<{ item: Row }> {
  @state seen = 0;

  @mounted
  count(): void {
    rowMounts++;
    this.seen = 1;
  }

  render() {
    return (
      <li data-seen={String(this.seen)} data-t={this.props.item.t}>
        {this.props.item.t}
      </li>
    );
  }
}

@Host("div")
class App extends Component {
  @state rows: Row[] = [
    { id: 1, t: "a", done: false },
    { id: 2, t: "b", done: false },
    { id: 3, t: "c", done: false },
  ];
  render() {
    return <ul>{list(this.rows, RowView)}</ul>;
  }
}

@Host("div")
class Plain extends Component {
  @state rows: Row[] = [
    { id: 1, t: "a", done: false },
    { id: 2, t: "b", done: false },
    { id: 3, t: "c", done: false },
  ];
  render() {
    return (
      <ul>
        {list(this.rows, (r: Row) => {
            mapperCalls++;
            return <li>{r.t}</li>;
          })}
      </ul>
    );
  }
}

const texts = (c: Element) =>
  Array.from(c.querySelectorAll("li"))
    .map((li) => li.textContent)
    .join(",");

/**
 * The rows, compared by IDENTITY.
 *
 * `toEqual` on DOM nodes compares them structurally, so two freshly built
 * `<li>a</li>` elements satisfy it — which is exactly what a rebuilt list
 * produces, and exactly what these tests exist to catch. Three of them passed
 * against unmodified code before this was noticed.
 */
function sameRows(container: Element, expected: Element[]): void {
  const actual = Array.from(container.querySelectorAll("li"));
  expect(actual).toHaveLength(expected.length);
  for (let i = 0; i < expected.length; i++) expect(actual[i]).toBe(expected[i]);
}

describe("a refetch keeps each row's identity", () => {
  test("same data, all-new objects: the rows are the same nodes", async () => {
    const app = await getDOM<Plain>(<Plain />);
    await app.settle();
    const before = [...app.container.querySelectorAll("li")];

    app.instance.rows = [
      { id: 1, t: "a", done: false },
      { id: 2, t: "b", done: false },
      { id: 3, t: "c", done: false },
    ];
    await app.settle();

    sameRows(app.container, before);
    expect(texts(app.container)).toBe("a,b,c");
  });

  test("a refetched row that CHANGED still renders its new value", async () => {
    // The reason the skip must stay on reference identity. This row matched by
    // value at the depth identity is decided on, but it is a different object
    // and its contents moved — so the mapper has to run.
    const app = await getDOM<Plain>(<Plain />);
    await app.settle();
    const before = [...app.container.querySelectorAll("li")];

    app.instance.rows = [
      { id: 1, t: "a", done: false },
      { id: 2, t: "B!", done: false },
      { id: 3, t: "c", done: false },
    ];
    await app.settle();

    expect(texts(app.container)).toBe("a,B!,c");
    // Row 2 kept its node — it is the same entity, changed.
    expect(app.container.querySelectorAll("li")[1]).toBe(before[1]);
  });

  test("a refetch that also REORDERS moves the rows", async () => {
    const app = await getDOM<Plain>(<Plain />);
    await app.settle();
    const [a, b, c] = [...app.container.querySelectorAll("li")];

    app.instance.rows = [
      { id: 3, t: "c", done: false },
      { id: 1, t: "a", done: false },
      { id: 2, t: "b", done: false },
    ];
    await app.settle();

    expect(texts(app.container)).toBe("c,a,b");
    sameRows(app.container, [c, a, b]);
  });

  test("per-row component state survives a refetch", async () => {
    // What the rebuild really cost. Each row is a component; a rebuilt list
    // destroys and recreates all of them, so anything they were holding is gone.
    const app = await getDOM<App>(<App />);
    await app.settle();
    expect(rowMounts).toBe(3);
    const before = [...app.container.querySelectorAll("li")];
    expect(before.map((li) => li.getAttribute("data-seen"))).toEqual(["1", "1", "1"]);

    rowMounts = 0;
    app.instance.rows = [
      { id: 1, t: "a", done: false },
      { id: 2, t: "b", done: false },
      { id: 3, t: "c", done: false },
    ];
    await app.settle();

    // Not one row was re-created.
    expect(rowMounts).toBe(0);
    sameRows(app.container, before);
  });

  test("genuinely different rows are NOT given each other's identity", async () => {
    const app = await getDOM<Plain>(<Plain />);
    await app.settle();
    const before = [...app.container.querySelectorAll("li")];

    app.instance.rows = [
      { id: 7, t: "x", done: false },
      { id: 8, t: "y", done: false },
    ];
    await app.settle();

    expect(texts(app.container)).toBe("x,y");
    const now = [...app.container.querySelectorAll("li")];
    // Different entities, so no continuity is claimed for them.
    expect(now[0]).not.toBe(before[0]);
    expect(now[1]).not.toBe(before[1]);
  });

  test("an update that keeps references still skips the untouched rows", async () => {
    // The fast path must not have moved: a reference hit still means "nothing
    // about this row can differ", and the mapper does not run.
    const app = await getDOM<Plain>(<Plain />);
    await app.settle();

    mapperCalls = 0;
    app.instance.rows = [app.instance.rows[0], { id: 2, t: "B", done: false }, app.instance.rows[2]];
    await app.settle();

    expect(mapperCalls).toBe(1);
    expect(texts(app.container)).toBe("a,B,c");
  });
});

describe("what identity is NOT carried across", () => {
  test("a page of different rows gets its own components", async () => {
    // The failure everyone fears from positional matching, and the one this has
    // to avoid to be worth having. Page 2 shares nothing with page 1, so there
    // are no anchors, so nothing is paired and nothing is carried.
    //
    // It is not a threshold or a ratio — the anchors ARE the evidence. An earlier
    // version had none of this and paired between the array ENDS instead, which
    // handed page 2 the identities and the half-typed drafts of page 1.
    const app = await getDOM<App>(<App />);
    await app.settle();
    const before = [...app.container.querySelectorAll("li")];
    rowMounts = 0;

    app.instance.rows = [
      { id: 9, t: "x", done: false },
      { id: 10, t: "y", done: false },
      { id: 11, t: "z", done: false },
    ];
    await app.settle();

    expect(rowMounts).toBe(3);
    const now = [...app.container.querySelectorAll("li")];
    for (let i = 0; i < 3; i++) expect(now[i]).not.toBe(before[i]);
  });

  test("a row inserted at the front is new, and the rows below keep theirs", async () => {
    // Pairing the run between anchors "first with first" gave the BRAND NEW row
    // the identity of the row it was inserted above, while the row that had
    // merely changed got a fresh one — precisely inverted. Overlap decides now.
    const app = await getDOM<App>(<App />);
    await app.settle();
    const before = [...app.container.querySelectorAll("li")];
    rowMounts = 0;

    app.instance.rows = [
      { id: 0, t: "new", done: false },
      { id: 1, t: "a", done: false },
      { id: 2, t: "b", done: false },
      { id: 3, t: "c", done: false },
    ];
    await app.settle();

    // Exactly one row is new; the three that existed kept their components.
    expect(rowMounts).toBe(1);
    const now = [...app.container.querySelectorAll("li")];
    expect(now[0]).not.toBe(before[0]);
    expect(now[1]).toBe(before[0]);
    expect(now[2]).toBe(before[1]);
    expect(now[3]).toBe(before[2]);
  });

  test("a spread copy is a new row, not a second claim on an old one", async () => {
    // Identity is a NON-enumerable symbol for exactly this. Object spread copies
    // own enumerable symbols, so an enumerable one would give the copy the same
    // identity as its original — two rows holding one id, which is the collision
    // minted identity exists to make impossible.
    const app = await getDOM<Plain>(<Plain />);
    await app.settle();

    const copies = app.instance.rows.map((r) => ({ ...r }));
    for (const copy of copies) expect(Object.getOwnPropertySymbols(copy)).toHaveLength(0);
  });

  test("a frozen item renders, and simply keeps the identity it had", async () => {
    // Nothing can be written onto it. That is not an error and not a special
    // case: identity falls back to the reference, which is what it was before
    // any of this existed.
    const app = await getDOM<Plain>(<Plain />);
    await app.settle();

    app.instance.rows = [Object.freeze({ id: 1, t: "frozen", done: false }) as Row];
    await app.settle();

    expect(texts(app.container)).toBe("frozen");
  });
});

describe("a field that only restates the position does not decide identity", () => {
  test("deleting the first row leaves the survivor with its OWN identity", async () => {
    // A form's array rows are `{ id, index, field }`, and `index` mirrors the
    // position. Delete the first row and the survivor is rebuilt as
    // `{ id: "b", index: 0 }`, to be matched against `{ id: "a", index: 0 }` and
    // `{ id: "b", index: 1 }` — one field each, a tie, and whichever came first
    // wins. The survivor took the DELETED row's identity: its node reused, and
    // with it the focus and caret of an input the user was typing in.
    //
    // Found by the SSR playground's smoke check, which marks a row's input and
    // asserts the survivor is the same element.
    interface FormRow {
      id: string;
      index: number;
      label: string;
    }

    @Host("div")
    class Rows extends Component {
      @state rows: FormRow[] = [
        { id: "a", index: 0, label: "first" },
        { id: "b", index: 1, label: "second" },
      ];
      render() {
        return <ul>{list(this.rows, (r: FormRow) => <li>{r.label}</li>)}</ul>;
      }
    }

    const app = await getDOM<Rows>(<Rows />);
    await app.settle();
    const [, second] = [...app.container.querySelectorAll("li")];

    // Row 0 removed; the survivor moves up, so it is a NEW object carrying the
    // index it now sits at.
    app.instance.rows = [{ id: "b", index: 0, label: "second" }];
    await app.settle();

    expect(texts(app.container)).toBe("second");
    expect(app.container.querySelector("li")).toBe(second);
  });
});

describe("an id that happens to look like a position", () => {
  test("editing the first row of an id-as-index list keeps it", async () => {
    // `items.map((x, i) => ({ id: i, … }))` is an ordinary way to build rows, and
    // it makes `id` equal its own index for every row. A rule that DISCARDED such
    // a field — added so a form row's `index` could not outvote its `id` — threw
    // away the only identity these rows have: editing the first row rebuilt it
    // and lost what its component was holding.
    //
    // So a positional-looking match is worth less than a distinct one rather than
    // nothing. The form row is decided by its `id`, and a row whose id is all it
    // has still has it.
    interface Indexed {
      id: number;
      t: string;
    }

    @Host("div")
    class Rows extends Component {
      @state rows: Indexed[] = [
        { id: 0, t: "a" },
        { id: 1, t: "b" },
        { id: 2, t: "c" },
      ];
      render() {
        return <ul>{list(this.rows, (r: Indexed) => <li>{r.t}</li>)}</ul>;
      }
    }

    const app = await getDOM<Rows>(<Rows />);
    await app.settle();
    const before = [...app.container.querySelectorAll("li")];

    app.instance.rows = [
      { id: 0, t: "A" },
      { id: 1, t: "b" },
      { id: 2, t: "c" },
    ];
    await app.settle();

    expect(texts(app.container)).toBe("A,b,c");
    sameRows(app.container, before);
  });
});
