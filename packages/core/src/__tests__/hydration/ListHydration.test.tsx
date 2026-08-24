import { describe, test, expect } from "vitest";
import { getDOM, instanceOf } from "../../test/setup";
import { state } from "../../base/decorators";
import { Component } from "../../base/Component";
import { list } from "../../base/list";
import { markComponents } from "../../hydration/ssr";
import { hydrateRoot } from "../../hydration/hydrate";

const microtask = () => Promise.resolve();

interface Row {
  label: string;
}

const a: Row = { label: "a" };
const b: Row = { label: "b" };
const c: Row = { label: "c" };

class List extends Component {
  @state items: Row[] = [a, b, c];
  render() {
    return (
      <div>
        <ul>
          {list(this.items, (row: Row) => (
            <li>{row.label}</li>
          ))}
        </ul>
      </div>
    );
  }
}

const dump = (root: Element) =>
  Array.from(root.querySelectorAll("li"))
    .map((li) => li.textContent)
    .join(",");

describe("hydration: a list is adopted, not rebuilt", () => {
  test("adopts the server's list nodes and keeps reordering them correctly", async () => {
    const server = await getDOM<List>(<List />);
    await server.settle();
    /**
     * The one step that turns a client render into SERVED markup.
     *
     * `getDOM` renders on the client, and a client render writes no markers — a component's range is
     * known from the record there. `markComponents` is the pass the server runs: the comment pair
     * around each component's nodes, with its state blob on the opening one. Without it a hydrating
     * client finds no marker where one belongs, builds the component fresh, and the page ends up
     * with both copies.
     */
    markComponents(server.container);
    const html = server.container.innerHTML;
    server.unmount();

    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = html;

    const before = Array.from(container.querySelectorAll("li"));
    expect(before.map((li) => li.textContent)).toEqual(["a", "b", "c"]);

    hydrateRoot(<List />, container);
    await microtask();

    // Adopted: the very same DOM nodes, not replacements.
    const after = Array.from(container.querySelectorAll("li"));
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
    expect(after[2]).toBe(before[2]);

    // And the record built during hydration has to be good enough to drive the
    // first client update: a reorder must move the adopted nodes, not rebuild.
    const instance = instanceOf<{ items: unknown[] }>(container.firstElementChild);
    instance.items = [c, a, b];
    await microtask();
    await microtask();

    expect(dump(container)).toBe("c,a,b");
    const reordered = Array.from(container.querySelectorAll("li"));
    expect(reordered[0]).toBe(before[2]);
    expect(reordered[1]).toBe(before[0]);
    expect(reordered[2]).toBe(before[1]);

    container.remove();
  });
});
