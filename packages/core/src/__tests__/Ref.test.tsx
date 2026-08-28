import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { getDOM } from "../test/setup";
import { Component, state, createRef } from "../index";

/**
 * `Ref` was a public export with no test at all. Four things were wrong, and
 * three of them were silent.
 */
describe("Ref", () => {
  beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  test("points at the element, and is cleared when it goes", async () => {
    const ref = createRef<HTMLElement>();
    class C extends Component {
      @state show = true;
      render() {
        return (
          <div>
            <div>
              {this.show ? (
                <p id="target" ref={ref}>
                  x
                </p>
              ) : null}
            </div>
          </div>
        );
      }
    }
    const app = await getDOM<C>(<C />);
    await app.settle();
    expect(ref.current?.id).toBe("target");
    expect(ref.current?.isConnected).toBe(true);

    app.instance.show = false;
    await app.settle();

    // It used to keep pointing at the detached element: `current` read as
    // present, `focus()` did nothing, and the subtree stayed reachable.
    expect(ref.current).toBe(null);
  });

  test("a callback ref is told when the element goes away", async () => {
    const seen: string[] = [];
    const ref = createRef<HTMLElement>((el) => seen.push(el ? `set:${el.id}` : "cleared"));
    class C extends Component {
      @state show = true;
      render() {
        return (
          <div>
            <div>
              {this.show ? (
                <p id="cb" ref={ref}>
                  x
                </p>
              ) : null}
            </div>
          </div>
        );
      }
    }
    const app = await getDOM<C>(<C />);
    await app.settle();
    app.instance.show = false;
    await app.settle();
    // The "cleared" call never happened before.
    expect(seen).toEqual(["set:cb", "cleared"]);
  });

  test("setting the same element again does not re-fire the callback", async () => {
    const seen: string[] = [];
    const ref = createRef<HTMLElement>((el) => seen.push(el ? "set" : "cleared"));

    class C extends Component {
      @state label = "a";
      render() {
        return (
          <div>
            <div>
              <p ref={ref}>{this.label}</p>
            </div>
          </div>
        );
      }
    }

    const app = await getDOM<C>(<C />);
    await app.settle();
    expect(seen).toEqual(["set"]);

    // Re-renders keep applying the same ref to the same node. `setCurrent`
    // returns early on an unchanged value, so a callback ref is not woken for
    // every render of its owner.
    app.instance.label = "b";
    await app.settle();
    app.instance.label = "c";
    await app.settle();
    expect(seen).toEqual(["set"]);
  });

  test("a ref handed from one element to another keeps the new one", async () => {
    const ref = createRef<HTMLElement>();
    class C extends Component {
      @state which = "a";
      render() {
        return (
          <div>
            <div>
              {this.which === "a" ? (
                <p id="a" ref={ref}>
                  a
                </p>
              ) : (
                <b id="b" ref={ref}>
                  b
                </b>
              )}
            </div>
          </div>
        );
      }
    }
    const app = await getDOM<C>(<C />);
    await app.settle();
    expect(ref.current?.id).toBe("a");

    app.instance.which = "b";
    await app.settle();

    // Mounting runs before unmounting, so the new element claims the ref first
    // and the old one's teardown must not wipe it. Releasing only when the ref
    // still points at the node being torn down is what keeps this "b".
    expect(ref.current?.id).toBe("b");
  });
});
