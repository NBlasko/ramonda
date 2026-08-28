import { describe, test, expect } from "vitest";
import { Component, list } from "../index";
import { state } from "../base/decorators";
import { getDOM } from "../test/setup";

/**
 * Focus, across a reorder that moves the row the reader is typing in.
 *
 * Moving a node means removing and re-inserting it, and a removed node loses focus — the platform's
 * doing, the same in plain JavaScript. Everything else about the row survives: measured before this,
 * the text, the caret and the row's own `@state` all came through and only the focus was gone. That
 * is the one loss with no sign on the page — the reader goes on typing into nothing.
 *
 * Restored by the framework rather than by an app, because an app cannot see it happen: nothing in a
 * render says which of its rows the platform is about to blur.
 */
class Rows extends Component {
  @state rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
  @state tick = 0;
  render() {
    return (
      <div data-tick={String(this.tick)}>
        {list(this.rows, (row) => (
          <input key={row.id} id={`f-${row.id}`} />
        ))}
      </div>
    );
  }
}

const field = (root: Element, id: string) => root.querySelector(`#f-${id}`) as HTMLInputElement;

/** How many times `.focus()` is CALLED, which a `focus` event listener cannot see. */
function countFocusCalls() {
  // The prototype's `focus` is an ACCESSOR here, not a plain method: assigning to it throws, and a
  // descriptor cannot carry both a getter and a value. So the getter is what gets replaced.
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "focus")!;
  const real = HTMLElement.prototype.focus;
  let count = 0;
  const counting = function (this: HTMLElement, ...args: unknown[]) {
    count++;
    return real.apply(this, args as never);
  };
  Object.defineProperty(HTMLElement.prototype, "focus", {
    configurable: true,
    get: () => counting,
  });
  return {
    count: () => count,
    stop: () => Object.defineProperty(HTMLElement.prototype, "focus", original),
  };
}

describe("focus across a reorder", () => {
  test("the row that was moved keeps the reader in it", async () => {
    const app = await getDOM<Rows>(<Rows />);
    await app.settle();

    const typing = field(app.container, "c");
    typing.focus();
    expect(document.activeElement).toBe(typing);

    // `c` goes to the front, which is the one row the minimal reorder actually moves.
    app.instance.rows = [{ id: "c" }, { id: "a" }, { id: "b" }];
    await app.settle();

    expect({
      sameNode: field(app.container, "c") === typing,
      stillFocused: document.activeElement === typing,
      order: [...app.container.querySelectorAll("input")].map((node) => node.id),
    }).toEqual({
      sameNode: true,
      stillFocused: true,
      order: ["f-c", "f-a", "f-b"],
    });
  });

  /**
   * A row that did NOT move keeps focus with nothing done for it, and the assertion is that nothing
   * IS done — `.focus()` is never called on it.
   *
   * Counting `focus` EVENTS cannot say that: focusing an element that is already focused fires no
   * event, so a redundant call is invisible from the outside. Measured, with the "did it actually
   * lose it" check removed: the page identical, the event count identical, and one extra call per
   * reorder. Counting the CALL is the only way to tell.
   */
  test("a row that stayed put is not touched", async () => {
    const app = await getDOM<Rows>(<Rows />);
    await app.settle();

    const typing = field(app.container, "a");
    typing.focus();

    const calls = countFocusCalls();
    try {
      // `c` moves to the front; `a` and `b` are the run the reorder leaves alone.
      app.instance.rows = [{ id: "c" }, { id: "a" }, { id: "b" }];
      await app.settle();

      expect({ stillFocused: document.activeElement === typing, calls: calls.count() }).toEqual({
        stillFocused: true,
        calls: 0,
      });
    } finally {
      calls.stop();
    }
  });

  /**
   * A render that moves nothing does not even ask. The walk returns before this on the fast path,
   * which is the common render — and the count is what says so, since the page looks identical
   * either way.
   */
  test("a render that moves nothing reads nothing", async () => {
    const app = await getDOM<Rows>(<Rows />);
    await app.settle();
    field(app.container, "b").focus();

    let reads = 0;
    const active = Object.getOwnPropertyDescriptor(Document.prototype, "activeElement")!;
    Object.defineProperty(Document.prototype, "activeElement", {
      ...active,
      get(this: Document) {
        reads++;
        return active.get?.call(this);
      },
    });

    try {
      app.instance.tick = 1;
      await app.settle();
      expect(reads).toBe(0);
    } finally {
      Object.defineProperty(Document.prototype, "activeElement", active);
    }
  });

  /**
   * Focus somewhere else on the page is left alone, and nothing in the code says so on purpose.
   *
   * The walk moves only nodes inside its own parent, so it cannot blur an element outside — and the
   * "did it actually lose focus" test then answers `no` for every one of them. A `parent.contains`
   * check was written first and removed: measured, it changed no outcome anywhere, and it would have
   * put a walk up the tree in front of a property read.
   */
  test("focus outside the parent doing the moving is not disturbed", async () => {
    class TwoLists extends Component {
      @state rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
      render() {
        return (
          <div>
            <input id="elsewhere" />
            <div id="theList">
              {list(this.rows, (row) => (
                <input key={row.id} id={`f-${row.id}`} />
              ))}
            </div>
          </div>
        );
      }
    }

    const app = await getDOM<TwoLists>(<TwoLists />);
    await app.settle();

    const outside = app.container.querySelector("#elsewhere") as HTMLInputElement;
    outside.focus();

    const calls = countFocusCalls();
    try {
      app.instance.rows = [{ id: "c" }, { id: "a" }, { id: "b" }];
      await app.settle();

      // Not merely still focused — never REACHED FOR. Without `contains`, this reorder would take
      // an interest in a field that is no business of its own, and the only thing standing between
      // that and stolen focus would be the element happening not to have lost it.
      expect({ focused: document.activeElement === outside, calls: calls.count() }).toEqual({
        focused: true,
        calls: 0,
      });
    } finally {
      calls.stop();
    }
  });
});
