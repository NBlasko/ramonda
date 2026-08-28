import { describe, test, expect } from "vitest";
import { getDOM } from "../../test/setup";
import { Component } from "../../base/Component";
import { createRef } from "../../base/Ref";
import { markComponents } from "../../hydration/ssr";
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
describe("hydration: a ref", () => {
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
    elementRef.setCurrent(null);

    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = html;

    hydrateRoot(<App />, container);

    expect(elementRef.current).toBe(container.querySelector("#e"));

    container.remove();
  });
});
