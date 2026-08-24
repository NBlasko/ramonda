import { describe, test, expect } from "vitest";
import { getDOM } from "../../test/setup";
import { Component } from "../../base/Component";
import { createRef } from "../../base/Ref";
import { hydrateRoot } from "../../hydration/hydrate";

/**
 * A component's `ref` on a hydrated page.
 *
 * Hydration adopts the server's element instead of building one, and `adoptHost`
 * did everything `createComponent` does for that host EXCEPT point the ref at it.
 * So on a page that was server-rendered, `<Child ref={r} />` left `r.current`
 * null — for as long as nothing re-rendered the component, which on a static page
 * is forever. An element's ref did fill, because hydration runs an element's
 * attributes through the ordinary path; only a component's went missing.
 *
 * It is the third route to the same host — create, update, adopt — and the ref
 * has to arrive by all three or it arrives by accident.
 */
describe("hydration: a component's ref", () => {
  test("fills when the host is adopted rather than created", async () => {
    class Child extends Component {
      render() {
        return (
          <div>
            <span id="c">hi</span>
          </div>
        );
      }
    }

    class App extends Component {
      render() {
        return <Child ref={ref} />;
      }
    }

    const ref = createRef<HTMLElement>();

    // 1. "server": render and capture the HTML, then throw the instances away.
    const server = await getDOM(<App />);
    await server.settle();
    const html = server.container.innerHTML;
    server.unmount();

    // The server render pointed the ref at ITS host; that element is gone now.
    ref.setCurrent(null);

    // 2. a fresh DOM out of that HTML — no instances, no listeners.
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = html;

    // 3. hydrate: the host is adopted, not built.
    hydrateRoot(<App />, container);

    const host = container.querySelector("div");
    expect(host).toBeTruthy();
    expect(ref.current).toBe(host);

    container.remove();
  });

  test("an element's ref fills too, on the same page", async () => {
    const elementRef = createRef<HTMLElement>();

    class App extends Component {
      render() {
        return (
          <div>
            <span id="e" ref={elementRef} />
          </div>
        );
      }
    }

    const server = await getDOM(<App />);
    await server.settle();
    const html = server.container.innerHTML;
    server.unmount();
    elementRef.setCurrent(null);

    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = html;

    hydrateRoot(<App />, container);

    expect(elementRef.current).toBe(container.querySelector("#e"));

    container.remove();
  });
});
