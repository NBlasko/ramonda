import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { getDOM } from "../test/setup";
import { Component, Host, state, createRef } from "../index";

/**
 * `Ref` was a public export with no test at all. Four things were wrong, and
 * three of them were silent.
 */
describe("Ref", () => {
  beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  test("points at the element, and is cleared when it goes", async () => {
    const ref = createRef<HTMLElement>();
    @Host("div")
    class C extends Component {
      @state show = true;
      render() {
        return (
          <div>
            {this.show ? (
              <p id="target" ref={ref}>
                x
              </p>
            ) : null}
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
    @Host("div")
    class C extends Component {
      @state show = true;
      render() {
        return (
          <div>
            {this.show ? (
              <p id="cb" ref={ref}>
                x
              </p>
            ) : null}
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

  test("a ref on a component receives its host element", async () => {
    const ref = createRef<HTMLElement>();
    @Host("section")
    class Child extends Component {
      render() {
        return <span>child</span>;
      }
    }
    @Host("div")
    class C extends Component {
      render() {
        return <Child ref={ref} />;
      }
    }
    const app = await getDOM<C>(<C />);
    await app.settle();
    // `<Child ref={r} />` was accepted and silently did nothing: a component's
    // props never reach the attribute pass. 1-1 says a component IS one
    // element, so the host is the answer.
    expect(ref.current?.nodeName).toBe("SECTION");
  });

  test("setting the same element again does not re-fire the callback", async () => {
    const seen: string[] = [];
    const ref = createRef<HTMLElement>((el) => seen.push(el ? "set" : "cleared"));

    @Host("div")
    class C extends Component {
      @state label = "a";
      render() {
        return (
          <div>
            <p ref={ref}>{this.label}</p>
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
    @Host("div")
    class C extends Component {
      @state which = "a";
      render() {
        return (
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
