import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { getDOM, instanceOf } from "../../test/setup";
import { Component } from "../../base/Component";
import { state } from "../../base/decorators";
import { Head, resetHeadRegistry } from "../../base/Head";
import { hydrateRoot } from "../../hydration/hydrate";
import { PORTAL_ATTR } from "../../helpers/constants";

/**
 * What a hydrated page's `Head` owns.
 *
 * The server writes the title and the meta tags into the HTML. On the client the
 * hook has to ADOPT them — `claim()` puts a tag in `owned`, and `@destroyed` removes
 * exactly what is owned — or the page leaves them behind when it goes.
 *
 * Adopting happens inside `apply()`, and on a hydrated page `apply()` may never
 * run: `applyOnCreate` is `@created({ env: "shared" })`, hydration runs only the
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
    resetHeadRegistry();
    for (const tag of [...document.head.querySelectorAll(`[${PORTAL_ATTR}]`)]) tag.remove();
    document.title = "";
  });

  const headTags = () => [...document.head.querySelectorAll(`[${PORTAL_ATTR}]`)];

  test("adopts the server's tags, so unmounting removes them", async () => {
    class Page extends Component {
      head = this.use(Head, () => ({
        title: "Products",
        description: "everything we sell",
      }));

      render() {
        return (
          <div>
            <p>page</p>
          </div>
        );
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
    resetHeadRegistry(); // the request ends; the browser is a different process

    // The server's tags are back in the document, standing for what the HTML carried.
    document.title = "Products";
    const meta = document.createElement("meta");
    meta.setAttribute("name", "description");
    meta.setAttribute("content", "everything we sell");
    // WITH the marker, because that is what shipped HTML carries. Measured: `renderPage` hands
    // back `<meta data-ramonda-portal="" content="…" name="description">`, and the marker is how
    // `collectHead` found the tag to serialize in the first place.
    meta.setAttribute(PORTAL_ATTR, "");
    document.head.appendChild(meta);
    // The marker STAYS. Measured on the real thing — `renderPage` hands back
    // `<meta data-ramonda-portal="" content="D" name="description">` — and it is how `collectHead`
    // found the tag in the first place, so a page that reached a browser carries it.
    //
    // It matters here because it is now the difference between a tag Ramonda wrote and one the
    // page author put in `index.html`: the first is the page's and goes with it, the second is
    // borrowed and is given back. Stripping it made this test ask for the author's tag to be
    // deleted, which is the fault the restore was written for.

    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = html;

    // 2. hydrate.
    hydrateRoot(<Page />, container);
    await Promise.resolve();

    // The hook adopted the server's meta rather than appending a second copy…
    const descriptions = [...document.head.querySelectorAll('meta[name="description"]')];
    expect(descriptions).toHaveLength(1);
    expect(descriptions[0].getAttribute(PORTAL_ATTR)).not.toBeNull();

    // …so tearing the page down takes it with it.
    const { unmountChildrenNodes } = await import("../../core/DiffAndMerge");
    unmountChildrenNodes([container as unknown as never]);

    expect(document.head.querySelectorAll('meta[name="description"]')).toHaveLength(0);
    container.remove();
  });

  test("an ordinary client page applies twice and cannot tell", async () => {
    /**
     * The cost of the fix, pinned rather than asserted in a comment.
     *
     * The hook cannot tell that it was hydrated rather than built, so it applies on
     * BOTH the shared create and the client one — and on a page that was never
     * hydrated, that second call is pure repetition. It has to be repetition that
     * changes nothing: `claim` adopts a tag it already owns only once, `upsert`
     * writes the same values back, and `previousTitle` is captured only while it is
     * undefined.
     *
     * So: one meta tag rather than two, and a title restored to what the document
     * had before rather than to the hook's own.
     */
    class Page extends Component {
      head = this.use(Head, () => ({ title: "Client", description: "built here" }));
      render() {
        return (
          <div>
            <p>page</p>
          </div>
        );
      }
    }

    document.title = "before";
    const app = await getDOM(<Page />);
    await app.settle();

    expect(document.head.querySelectorAll('meta[name="description"]')).toHaveLength(1);
    expect(document.title).toBe("Client");

    app.unmount();

    expect(document.head.querySelectorAll('meta[name="description"]')).toHaveLength(0);
    expect(document.title).toBe("before");
  });

  test("the hook is live after hydration, and gives the title back on the way out", async () => {
    class Page extends Component {
      @state title = "Products";
      head = this.use(Head, () => ({ title: this.title }));
      render() {
        return (
          <div>
            <p>page</p>
          </div>
        );
      }
    }

    const server = await getDOM(<Page />);
    await server.settle();
    const html = server.container.innerHTML;
    server.unmount();
    for (const tag of headTags()) tag.remove();

    // The request ends here. `renderPage` clears the head registry at exactly this
    // point, and it has to be cleared for the same reason it is there: the browser
    // is a different process, and it starts with the document the HTML describes.
    resetHeadRegistry();

    // The page as the browser received it: the server's title already in place.
    document.title = "Products";

    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = html;

    hydrateRoot(<Page />, container);
    await Promise.resolve();

    const instance = instanceOf<Page>(container.firstChild);

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
