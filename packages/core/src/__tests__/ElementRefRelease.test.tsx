import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { getDOM } from "../test/setup";
import { Component, Host, state, createRef } from "../index";
import { REF_SYM } from "../helpers/constants";

/**
 * An element whose `ref` prop goes away.
 *
 * `ref` is not a DOM attribute, so it is never among the PREVIOUS attributes the
 * diff reads back off the node — and the attach loop only walks the keys present
 * in the NEXT ones. A disappearing `ref` is therefore invisible to both loops, and
 * the element kept holding the handle: a stale strong reference from the node to a
 * ref nothing points at, and a `current` still aimed at an element the JSX no
 * longer connects it to.
 *
 * A component's ref has behaved correctly since it was unified across create,
 * update and adopt. This is the same rule on the element side.
 *
 * The thing NOT to break while fixing it: an element re-asserts its ref on every
 * render, deliberately, and that is what makes two elements sharing one ref fall
 * back to the first when the second goes away. Releasing must be about the ref
 * DISAPPEARING from the JSX, not about the handle being unchanged.
 */
describe("an element's ref, when the JSX stops giving it one", () => {
  beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  const holds = (node: Element | null) => (node as unknown as { [REF_SYM]?: unknown })?.[REF_SYM] !== undefined;

  test("moving it to another element releases the first", async () => {
    const ref = createRef<HTMLElement>();

    @Host("div")
    class App extends Component {
      @state onFirst = true;

      render() {
        return (
          <div>
            <p id="a" ref={this.onFirst ? ref : undefined} />
            <span id="b" ref={this.onFirst ? undefined : ref} />
          </div>
        );
      }
    }

    const app = await getDOM<App>(<App />);
    await app.settle();

    const a = app.container.querySelector("#a");
    const b = app.container.querySelector("#b");
    expect(ref.current).toBe(a);
    expect(holds(a)).toBe(true);
    expect(holds(b)).toBe(false);

    app.instance.onFirst = false;
    await app.settle();

    expect(ref.current).toBe(b);
    expect(holds(b)).toBe(true);
    // The one that lost it must not still be holding the handle.
    expect(holds(a)).toBe(false);
  });

  test("removing it with nobody to take it clears the ref", async () => {
    const ref = createRef<HTMLElement>();

    @Host("div")
    class App extends Component {
      @state keep = true;

      render() {
        return <p id="a" ref={this.keep ? ref : undefined} />;
      }
    }

    const app = await getDOM<App>(<App />);
    await app.settle();

    const a = app.container.querySelector("#a");
    expect(ref.current).toBe(a);

    app.instance.keep = false;
    await app.settle();

    // The element is still on the page; the JSX simply stopped connecting it.
    expect(app.container.querySelector("#a")).toBe(a);
    expect(holds(a)).toBe(false);
    expect(ref.current).toBe(null);
  });

  test("swapping one ref for another releases the old handle", async () => {
    const first = createRef<HTMLElement>();
    const second = createRef<HTMLElement>();

    @Host("div")
    class App extends Component {
      @state useFirst = true;

      render() {
        return <p id="a" ref={this.useFirst ? first : second} />;
      }
    }

    const app = await getDOM<App>(<App />);
    await app.settle();
    const a = app.container.querySelector("#a");
    expect(first.current).toBe(a);

    app.instance.useFirst = false;
    await app.settle();

    expect(second.current).toBe(a);
    expect(first.current).toBe(null);
    expect(holds(a)).toBe(true);
  });

  test("two elements sharing one ref still fall back to the survivor", async () => {
    /**
     * The behaviour the fix must not cost. Both claim it; the last one written
     * wins. When the second goes away, the first re-asserts on the same pass and
     * gets it back — which only works because an element applies its ref on every
     * render rather than only when the handle changes.
     */
    const ref = createRef<HTMLElement>();

    @Host("div")
    class App extends Component {
      @state both = true;

      render() {
        return (
          <div>
            <p id="a" ref={ref} />
            {this.both ? <span id="b" ref={ref} /> : null}
          </div>
        );
      }
    }

    const app = await getDOM<App>(<App />);
    await app.settle();
    expect(ref.current).toBe(app.container.querySelector("#b"));

    app.instance.both = false;
    await app.settle();

    expect(ref.current).toBe(app.container.querySelector("#a"));
  });
});
