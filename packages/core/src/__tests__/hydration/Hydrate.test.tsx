import { describe, test, expect } from "vitest";
import { getDOM, instanceOf } from "../../test/setup";
import { state } from "../../base/decorators";
import { Component } from "../../base/Component";
import { markComponents } from "../../hydration/ssr";
import { hydrateRoot } from "../../hydration/hydrate";
import type { ComponentChild } from "../../types/vdom";

const microtask = () => Promise.resolve();

/**
 * Turns a client-rendered container into what the server would have SERVED.
 *
 * The one pass that matters: `markComponents` wraps each component's nodes in the comment pair a
 * hydrating client reads and puts its state blob on the opening one. It used to be a hand-written
 * walk stamping an attribute on each host — there is no host to stamp now, and a second
 * implementation of the marker format would be a second thing to keep in step with hydration.
 */
const injectBlobs = markComponents;

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
    class Counter extends Component {
      @state count = 0;
      onClick() {
        this.count++;
      }
      render() {
        return (
          <div onclick={this.onClick}>
            <span id="c">{this.count}</span>
          </div>
        );
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
    const host = container.firstElementChild;
    expect(instanceOf<Counter>(host)).toBeTruthy();
    expect(instanceOf<Counter>(host).count).toBe(5);

    // The markup's own listener, adopted with the element the server wrote.
    (container.firstElementChild as HTMLElement).dispatchEvent(new MouseEvent("click"));
    await microtask();
    expect(container.querySelector("#c")?.textContent).toBe("6");

    container.remove();
  });

  test("hydrates a nested component tree, restoring each carrier's state", async () => {
    class Child extends Component<{ id: string }> {
      @state hits = 0;
      onClick() {
        this.hits++;
      }
      render() {
        return (
          <div onclick={this.onClick}>
            <span data-child={this.props.id}>{this.hits}</span>
          </div>
        );
      }
    }

    class Parent extends Component {
      @state title = "t";
      render() {
        return (
          <div>
            <section>
              <h1>{this.title}</h1>
              <Child id="a" />
              <Child id="b" />
            </section>
          </div>
        );
      }
    }

    // "server"
    const server = await serverRender(<Parent />);
    // give each child a distinct restored state
    const childHosts = server.container.querySelectorAll("div div");
    // find child instances via their host nodes
    const childInstances = Array.from(server.container.querySelectorAll("[data-child]")).map((el) =>
      instanceOf<Child>(el.parentElement),
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
    class Widget extends Component {
      @state n = 1;
      render() {
        return (
          <div>
            <span id="w">{this.n}</span>
          </div>
        );
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
