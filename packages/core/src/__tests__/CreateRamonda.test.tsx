import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { getDOM } from "../test/setup";
import { Component, Host, state, h } from "../index";

/**
 * `createRamonda` builds every vnode, so anything it gets wrong is wrong
 * everywhere. Two things live here: normalizing `class` to `className` once per
 * vnode rather than on every attribute diff, and attaching a component's
 * children to its props.
 */
@Host("div")
class Box extends Component<{ label?: string; children?: unknown }> {
  render() {
    return <span>{this.props.children as never}</span>;
  }
}

describe("createRamonda", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  test("class is normalized to className on an element", async () => {
    @Host("div")
    class C extends Component {
      render() {
        return h("p", { class: "legacy" }, "x") as any;
      }
    }
    const app = await getDOM<C>(<C />);
    await app.settle();
    expect(app.container.querySelector("p")?.className).toBe("legacy");
    expect(app.container.querySelector("p")?.getAttribute("class")).toBe("legacy");
  });

  test("an explicit className wins over a stray class", async () => {
    @Host("div")
    class C extends Component {
      render() {
        return h("p", { class: "old", className: "new" }, "x") as any;
      }
    }
    const app = await getDOM<C>(<C />);
    await app.settle();
    expect(app.container.querySelector("p")?.className).toBe("new");
  });

  test("class is normalized on a component prop too", async () => {
    @Host("div")
    class Inner extends Component<{ className?: string }> {
      render() {
        return <span>{this.props.className ?? "none"}</span>;
      }
    }
    @Host("div")
    class C extends Component {
      render() {
        return h(Inner as any, { class: "from-class" }) as any;
      }
    }
    const app = await getDOM<C>(<C />);
    await app.settle();
    expect(app.container.textContent).toBe("from-class");
  });

  test("the caller's props object is not written to", async () => {
    // It used to be: `attributes.children = children` mutated whatever the
    // caller passed. JSX builds a fresh object per element so it never showed
    // there, but `h()` is public and callable directly, and reusing a props
    // object is a reasonable thing to write.
    const reused: Record<string, unknown> = { label: "reused" };
    h(Box as unknown as never, reused as never, "child-one" as never);

    expect(reused.children).toBeUndefined();
  });

  test("two components sharing one props object keep their own children", async () => {
    const shared: Record<string, unknown> = { label: "A" };
    @Host("div")
    class C extends Component {
      @state tick = 0;
      render() {
        return (
          <div>
            {h(Box as any, shared, "one") as any}
            {h(Box as any, shared, "two") as any}
          </div>
        );
      }
    }
    const app = await getDOM<C>(<C />);
    await app.settle();
    // Measured before the fix: "twotwo" — the second element's children
    // overwrote the first's on the object they shared, so both rendered it.
    expect(app.container.textContent).toBe("onetwo");
    expect(shared.children).toBeUndefined();
  });
});
