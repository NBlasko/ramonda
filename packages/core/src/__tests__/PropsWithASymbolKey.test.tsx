import { describe, expect, test } from "vitest";
import { getDOM } from "../test/setup";
import { Component } from "../base/Component";
import { state } from "../base/decorators";

/**
 * A prop under a SYMBOL key, which the props proxy answers differently from every other prop.
 *
 * `createPropsProxy`'s first line returns `rawProps[key]` for a symbol and stops there — no signal
 * is made, so the read is not tracked. Every other prop goes through a `State` whose listener is
 * the component's own `reBuild`.
 *
 * Nothing exercised that branch: the union of both coverage runs had it unhit, and made to THROW it
 * still did not fire in any of 1466 tests. It is reachable all the same — `<Panel {...{[sym]: v}} />`
 * is legal JSX and a symbol is what a library reaches for when it wants a key an app cannot collide
 * with — so what it does is worth stating rather than leaving to be rediscovered.
 *
 * Measured, and the second half was not what I expected:
 *
 *     first render      n=1 tag=a   (1 render)
 *     tag -> "b"        n=1 tag=a   (1 render)   ← the child did not render
 *     n   -> 2          n=2 tag=b   (2 renders)  ← and the symbol read FRESH
 *
 * So the value is not a snapshot taken once. The diff refreshes `rawProps` whether or not the child
 * renders, and the symbol read goes straight to it — what a symbol prop lacks is the SIGNAL, so a
 * change to one alone schedules nothing.
 */
describe("a prop under a symbol key", () => {
  const TAG = Symbol("tag");

  test("reads through, is not reactive, and is not stale when something else renders", async () => {
    let renders = 0;

    class Child extends Component<{ n: number }> {
      render() {
        renders++;
        const tag = (this.props as unknown as Record<symbol, unknown>)[TAG];
        return <p>{`n=${this.props.n} tag=${String(tag)}`}</p>;
      }
    }

    class Parent extends Component {
      @state n = 1;
      @state tag = "a";
      render() {
        // The symbol rides along on an object typed by its STRING keys, which is the only spelling
        // that type-checks: `{...({ [TAG]: v } as never)}` cannot be spread, and widening the
        // component's props would change the thing under test.
        const props: { n: number } = { n: this.n };
        (props as unknown as Record<symbol, unknown>)[TAG] = this.tag;
        return <div>{(<Child {...props} />) as never}</div>;
      }
    }

    const app = await getDOM<Parent>(<Parent />);
    expect(app.container.textContent).toBe("n=1 tag=a");
    expect(renders).toBe(1);

    // Only the symbol changes. The parent re-renders; the child has no signal for a symbol, so it
    // does not, and the page still shows the old value.
    app.instance.tag = "b";
    await app.settle();
    expect(app.container.textContent).toBe("n=1 tag=a");
    expect(renders).toBe(1);

    // A tracked prop changes, so the child renders — and the symbol comes back CURRENT rather than
    // as the value it was first given.
    app.instance.n = 2;
    await app.settle();
    expect(app.container.textContent).toBe("n=2 tag=b");
    expect(renders).toBe(2);

    app.unmount();
  });
});
