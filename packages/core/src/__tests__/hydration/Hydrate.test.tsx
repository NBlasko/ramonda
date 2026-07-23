import { describe, test, expect } from "vitest";
import { getDOM } from "../../test/setup";
import { state, Host, onElement } from "../../base/decorators";
import { Component } from "../../base/Component";
import { serializeComponentToJSON } from "../../hydration/serialize";
import { hydrateRoot } from "../../hydration/hydrate";
import { STATE_ATTR } from "../../helpers/constants";
import type { ComponentChild } from "../../types/vdom";

const microtask = () => Promise.resolve();

/**
 * Simulates SSR: walk the (client-rendered) server DOM and stamp each carrier
 * with its serialized state blob, exactly like the server wiring will.
 */
function injectBlobs(root: Node): void {
  const node = root as { _componentInstance?: object } & Element;
  if (node._componentInstance && typeof node.setAttribute === "function") {
    node.setAttribute(STATE_ATTR, serializeComponentToJSON(node._componentInstance));
  }
  root.childNodes.forEach(injectBlobs);
}

/**
 * Produces a fresh "server HTML" DOM (no JS wiring) with blobs embedded.
 * JSX erases to `VNode`, so the component type can't be inferred from `<Counter />`;
 * pass it explicitly (`serverRender<Counter>(...)`) to type `server.instance`.
 */
async function serverRender<T = unknown>(vnode: ComponentChild) {
  return getDOM<T>(vnode);
}

describe("hydration: DOM adopt/walk", () => {
  test("adopts server DOM, restores state, and wires up listeners", async () => {
    @Host("div")
    class Counter extends Component {
      @state count = 0;
      @onElement("click")
      onClick() {
        this.count++;
      }
      render() {
        return <span id="c">{this.count}</span>;
      }
    }

    // 1. "server": render, bring to a state, stamp blobs, capture HTML.
    const server = await serverRender<Counter>(<Counter />);
    server.instance.count = 5;
    await server.settle();
    injectBlobs(server.container);
    const html = server.container.innerHTML;
    server.unmount();

    // 2. fresh DOM from the server HTML (no listeners, no instances).
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = html;

    const spanBefore = container.querySelector("#c")!;
    expect(spanBefore.textContent).toBe("5");

    // 3. hydrate.
    hydrateRoot(<Counter />, container);

    // Node identity preserved (adopted, not recreated).
    const spanAfter = container.querySelector("#c")!;
    expect(spanAfter).toBe(spanBefore);

    // State restored onto a live instance.
    const host = container.firstElementChild as { _componentInstance?: Counter };
    expect(host._componentInstance).toBeTruthy();
    expect(host._componentInstance!.count).toBe(5);

    // Listener attached (client-only @onElement effect ran during hydration).
    (container.firstElementChild as HTMLElement).dispatchEvent(new MouseEvent("click"));
    await microtask();
    expect(container.querySelector("#c")?.textContent).toBe("6");

    container.remove();
  });

  test("hydrates a nested component tree, restoring each carrier's state", async () => {
    @Host("div")
    class Child extends Component<{ id: string }> {
      @state hits = 0;
      @onElement("click")
      onClick() {
        this.hits++;
      }
      render() {
        return <span data-child={this.props.id}>{this.hits}</span>;
      }
    }

    @Host("div")
    class Parent extends Component {
      @state title = "t";
      render() {
        return (
          <section>
            <h1>{this.title}</h1>
            <Child id="a" />
            <Child id="b" />
          </section>
        );
      }
    }

    // "server"
    const server = await serverRender(<Parent />);
    // give each child a distinct restored state
    const childHosts = server.container.querySelectorAll("div div");
    // find child instances via their host nodes
    const childInstances = Array.from(server.container.querySelectorAll("[data-child]")).map(
      (el) => (el.parentElement as { _componentInstance?: Child })._componentInstance!,
    );
    childInstances[0].hits = 3;
    childInstances[1].hits = 7;
    await server.settle();
    injectBlobs(server.container);
    const html = server.container.innerHTML;
    server.unmount();
    void childHosts;

    // fresh DOM
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = html;

    hydrateRoot(<Parent />, container);

    // Both children restored and interactive at their own level.
    const childA = container.querySelector('[data-child="a"]')!;
    const childB = container.querySelector('[data-child="b"]')!;
    expect(childA.textContent).toBe("3");
    expect(childB.textContent).toBe("7");

    (childA.parentElement as HTMLElement).dispatchEvent(new MouseEvent("click"));
    await microtask();
    expect(container.querySelector('[data-child="a"]')?.textContent).toBe("4");
    // B untouched
    expect(container.querySelector('[data-child="b"]')?.textContent).toBe("7");

    container.remove();
  });

  test("recreates on the client when the server DOM is missing", async () => {
    @Host("div")
    class Widget extends Component {
      @state n = 1;
      render() {
        return <span id="w">{this.n}</span>;
      }
    }

    // Empty container → nothing to adopt → fallback create.
    const container = document.createElement("div");
    document.body.appendChild(container);

    hydrateRoot(<Widget />, container);

    expect(container.querySelector("#w")?.textContent).toBe("1");
    container.remove();
  });
});
