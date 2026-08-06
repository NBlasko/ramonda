import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { getDOM } from "../../test/setup";
import { Component } from "../../base/Component";
import { Host, state } from "../../base/decorators";
import { Head } from "../../base/Head";
import { hydrateRoot } from "../../hydration/hydrate";
import { HEAD_ATTR } from "../../helpers/constants";

/**
 * What a hydrated page's `Head` owns.
 *
 * The server writes the title and the meta tags into the HTML. On the client the
 * hook has to ADOPT them — `claim()` puts a tag in `owned`, and `@destroy` removes
 * exactly what is owned — or the page leaves them behind when it goes.
 *
 * Adopting happens inside `apply()`, and on a hydrated page `apply()` may never
 * run: `applyOnCreate` is `@create({ env: "shared" })`, hydration runs only the
 * `env === "client"` creates, and `@watchProp` deliberately does not fire on
 * mount. So the tags the server wrote were nobody's, and removing the component
 * that put them there left them in the document.
 *
 * In an app that navigates, the next page's `Head` claims them on its way past and
 * the fault is invisible. It is the page that unmounts with nothing replacing it —
 * a widget torn down, a route with no Head after it — that shows it.
 */
describe("hydration: the Head owns what the server wrote", () => {
  beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));
  afterEach(() => {
    vi.restoreAllMocks();
    for (const tag of [...document.head.querySelectorAll(`[${HEAD_ATTR}]`)]) tag.remove();
    document.title = "";
  });

  const headTags = () => [...document.head.querySelectorAll(`[${HEAD_ATTR}]`)];

  test("adopts the server's tags, so unmounting removes them", async () => {
    @Host("div")
    class Page extends Component {
      head = this.use(Head, () => ({
        title: "Products",
        description: "everything we sell",
      }));

      render() {
        return <p>page</p>;
      }
    }

    // 1. "server": render, then keep the head tags it wrote and throw the
    //    instances away — which is what shipping HTML does.
    document.title = "before";
    const server = await getDOM(<Page />);
    await server.settle();
    const html = server.container.innerHTML;
    expect(headTags().length).toBeGreaterThan(0);
    server.unmount();

    // The server's tags are back in the document, standing for what the HTML carried.
    document.title = "Products";
    const meta = document.createElement("meta");
    meta.setAttribute("name", "description");
    meta.setAttribute("content", "everything we sell");
    document.head.appendChild(meta);
    for (const tag of headTags()) tag.removeAttribute(HEAD_ATTR);

    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = html;

    // 2. hydrate.
    hydrateRoot(<Page />, container);
    await Promise.resolve();

    // The hook adopted the server's meta rather than appending a second copy…
    const descriptions = [...document.head.querySelectorAll('meta[name="description"]')];
    expect(descriptions).toHaveLength(1);
    expect(descriptions[0].getAttribute(HEAD_ATTR)).not.toBeNull();

    // …so tearing the page down takes it with it.
    const { unmountChildrenNodes } = await import("../../core/DiffAndMerge");
    unmountChildrenNodes([container as unknown as never]);

    expect(document.head.querySelectorAll('meta[name="description"]')).toHaveLength(0);
    container.remove();
  });

  test("the hook is live after hydration, and gives the title back on the way out", async () => {
    @Host("div")
    class Page extends Component {
      @state title = "Products";
      head = this.use(Head, () => ({ title: this.title }));
      render() {
        return <p>page</p>;
      }
    }

    const server = await getDOM(<Page />);
    await server.settle();
    const html = server.container.innerHTML;
    server.unmount();
    for (const tag of headTags()) tag.remove();

    // The page as the browser received it: the server's title already in place.
    document.title = "Products";

    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = html;

    hydrateRoot(<Page />, container);
    await Promise.resolve();

    const instance = (container.firstChild as { _componentInstance?: Page })._componentInstance!;

    // Live: a later change reaches the document, which it could not if the hook
    // had never taken hold of the title.
    instance.title = "Basket";
    await Promise.resolve();
    expect(document.title).toBe("Basket");

    const { unmountChildrenNodes } = await import("../../core/DiffAndMerge");
    unmountChildrenNodes([container as unknown as never]);

    /**
     * Back to what the document carried before the hook touched it — which on a
     * HYDRATED page is the server's own title, because there was never anything
     * earlier. Not a weaker outcome than a client-built page's, just the honest
     * one: the page is gone and the title is what the HTML arrived with.
     */
    expect(document.title).toBe("Products");
    container.remove();
  });
});
