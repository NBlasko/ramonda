import { describe, expect, test } from "vitest";
import { getDOM } from "../test/setup";
import { Component } from "../base/Component";
import { compute, state } from "../base/decorators";

class PlainPanel extends Component<{ slots: { body: unknown } }> {
  render() {
    return <section>{this.props.slots.body}</section>;
  }
}

/**
 * A slot object handed over from a `@compute` rather than written in the JSX.
 *
 * Pinned because a demo now depends on it. `fresh-object-in-props` reports
 * `slots={{ body: … }}` — a literal is rebuilt every render, so the child can never be skipped —
 * and the fix it advises is a `@compute`. That fix is only advice worth giving if the slot still
 * arrives and still follows its state, which is what this asserts. Both halves matter: the
 * caching is the point, and a cache that stopped updating would be the worse bug.
 */
describe("a slot object handed over from a @compute", () => {
  test("it renders, and it follows the state it is built from", async () => {
    class Page extends Component {
      @state rows = ["one", "two"];

      @compute get slots() {
        return { body: this.rows.map((label) => <li className="chip">{label}</li>) };
      }

      render() {
        return <PlainPanel slots={this.slots} />;
      }
    }

    const { container, instance } = (await getDOM(<Page />)) as never as {
      container: HTMLElement;
      instance: Page;
    };
    expect(container.querySelectorAll("li.chip")).toHaveLength(2);
    (instance as unknown as { rows: string[] }).rows = ["one", "two", "three"];
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelectorAll("li.chip")).toHaveLength(3);
    expect(container.textContent).toContain("three");
  });
});
