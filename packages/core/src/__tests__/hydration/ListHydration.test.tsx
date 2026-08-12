import { describe, test, expect } from "vitest";
import { getDOM } from "../../test/setup";
import { state, Host } from "../../base/decorators";
import { Component } from "../../base/Component";
import { list } from "../../base/list";
import { hydrateRoot } from "../../hydration/hydrate";

const microtask = () => Promise.resolve();

interface Row {
  label: string;
}

const a: Row = { label: "a" };
const b: Row = { label: "b" };
const c: Row = { label: "c" };

@Host("div")
class List extends Component {
  @state items: Row[] = [a, b, c];
  render() {
    return <ul>{list(this.items, (row: Row) => <li>{row.label}</li>)}</ul>;
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
    const host = container.firstElementChild as { _componentInstance?: List };
    const instance = host._componentInstance!;
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
