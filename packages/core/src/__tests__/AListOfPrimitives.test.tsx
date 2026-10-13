import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { getDOM } from "../test/setup";
import { Component, list, state } from "../index";
import { created, destroyed } from "../base/decorators";
import { resetDiagnostics } from "../debug/diagnostics";

/**
 * A list whose rows are not objects.
 *
 * `ListIdentityAudit.test.tsx` is thorough about what `list()` promises across a refetch — twenty-six
 * arrangements, filters, sorts, pagination, grids — and every row in it is an OBJECT. The identity
 * machinery in `helpers/itemIdentity.ts` has a branch for the other case at every step it takes
 * (`item === null || typeof item !== "object"` appears four times, and `signature` has a `p` prefix
 * for a primitive), and none of them was exercised. `list(["a", "b", "c"], …)` is not an exotic
 * shape; it is the first list anybody writes.
 *
 * Everything below was measured before it was asserted, and two of the answers are not what I would
 * have written down: a reversed list of strings keeps every component AND the same DOM node, while
 * three copies of one string rebuild all three. Both are right, and the reason is the same — a value
 * is its own identity, so equal strings are indistinguishable and the only honest thing to do with
 * three of them is to stop pairing.
 *
 * **What these tests do and do not hold, planted rather than assumed.** Taking the primitive check
 * out of `reportUnidentifiable` fails two of them, which is the exclusion that matters: a list of
 * strings must not be nagged about keys. Flattening `signature` so every primitive hashes alike
 * fails NOTHING here — the bucket key is explicitly "never enough to say two rows are the same row",
 * `valueEqual` decides that, and these arrangements never put two different primitives in one
 * bucket. Said rather than dressed up; a test that cannot fail is not evidence.
 */
let creates = 0;
let destroys = 0;
const codes: string[] = [];

class Row extends Component<{ text: unknown }> {
  @created
  countCreate(): void {
    creates++;
  }
  @destroyed
  countDestroy(): void {
    destroys++;
  }
  render() {
    return <li>{String(this.props.text)}</li>;
  }
}

class Page extends Component {
  @state items: unknown[] = ["a", "b", "c"];
  render() {
    return (
      <ul>
        {list(this.items, (item: unknown) => (
          <Row text={item} />
        ))}
      </ul>
    );
  }
}

const mount = () => getDOM<Page>(<Page />);
const rowsIn = (el: Element) => Array.from(el.querySelectorAll("li"));

beforeEach(() => {
  resetDiagnostics();
  creates = 0;
  destroys = 0;
  codes.length = 0;
  globalThis.__RAMONDA_DIAGNOSTICS__ = (record) => codes.push(record.code);
});

afterEach(() => {
  globalThis.__RAMONDA_DIAGNOSTICS__ = undefined;
  resetDiagnostics();
});

describe("a list of primitives", () => {
  test("renders one row per item", async () => {
    const app = await mount();
    await app.settle();

    expect(app.container.textContent).toBe("abc");
    expect(rowsIn(app.container)).toHaveLength(3);
    expect(creates).toBe(3);

    app.unmount();
  });

  test("a reorder MOVES the rows, keeping the component and the node", async () => {
    const app = await mount();
    await app.settle();
    const [, middle] = rowsIn(app.container);
    creates = destroys = 0;

    app.instance.items = ["c", "b", "a"];
    await app.settle();

    expect(app.container.textContent).toBe("cba");
    expect({ creates, destroys }).toEqual({ creates: 0, destroys: 0 });
    // The strongest form of it: `b`'s <li> is the same DOM node it was, so it moved rather than
    // being rewritten in place. A value is its own identity, and that is enough to pair by.
    expect(rowsIn(app.container)[1]).toBe(middle);

    app.unmount();
  });

  test("an append builds exactly one row", async () => {
    const app = await mount();
    await app.settle();
    creates = destroys = 0;

    app.instance.items = ["a", "b", "c", "d"];
    await app.settle();

    expect(app.container.textContent).toBe("abcd");
    expect({ creates, destroys }).toEqual({ creates: 1, destroys: 0 });

    app.unmount();
  });

  test("items that are equal to each other are NOT paired, and that is the honest answer", async () => {
    // Three copies of one string cannot be told apart, so there is no "which row is which" to
    // preserve. Measured: all three are rebuilt. Pairing them by position would be a guess, and a
    // wrong guess puts one row's state on another — the failure this machinery exists to avoid.
    const app = await mount();
    await app.settle();
    creates = destroys = 0;

    app.instance.items = ["x", "x", "x"];
    await app.settle();

    expect(app.container.textContent).toBe("xxx");
    expect(rowsIn(app.container)).toHaveLength(3);
    expect({ creates, destroys }).toEqual({ creates: 3, destroys: 3 });

    app.unmount();
  });

  test("dropping one of several equal items destroys exactly one", async () => {
    const app = await mount();
    await app.settle();
    app.instance.items = ["x", "x", "x"];
    await app.settle();
    creates = destroys = 0;

    app.instance.items = ["x", "x"];
    await app.settle();

    expect(app.container.textContent).toBe("xx");
    expect({ creates, destroys }).toEqual({ creates: 0, destroys: 1 });

    app.unmount();
  });

  test("null and a change of type are a change, not a crash", async () => {
    const app = await mount();
    await app.settle();
    creates = destroys = 0;

    app.instance.items = [1, 2, null, "x"];
    await app.settle();

    // Nothing in common with three strings, so every row is new — and `null` renders rather than
    // throwing on the way through an identity walk that reaches for `Object.keys`. Four built, the
    // three that were there torn down.
    expect(app.container.textContent).toBe("12nullx");
    expect({ creates, destroys }).toEqual({ creates: 4, destroys: 3 });

    app.unmount();
  });

  test("a primitive beside an object does not upset either", async () => {
    const app = await mount();
    await app.settle();
    creates = destroys = 0;

    app.instance.items = [{ id: 1 }, "mixed", 7];
    await app.settle();

    expect(rowsIn(app.container)).toHaveLength(3);
    expect(app.container.textContent).toContain("mixed");
    expect(app.container.textContent).toContain("7");

    app.unmount();
  });

  test("no row is ever reported as unidentifiable, because a value identifies itself", async () => {
    // The diagnostic for a row with nothing to tell it apart is for OBJECTS: a bag of fields that
    // every sibling shares. A primitive is excluded at the top of `reportUnidentifiable`, and this
    // is the assertion that keeps that exclusion — a list of strings must not be nagged about keys.
    const app = await mount();
    await app.settle();
    app.instance.items = ["c", "b", "a"];
    await app.settle();
    app.instance.items = ["x", "x", "x"];
    await app.settle();
    app.instance.items = [1, null, "x"];
    await app.settle();

    expect(codes).toEqual([]);

    app.unmount();
  });
});
