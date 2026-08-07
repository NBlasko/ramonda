import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { Component } from "../../base/Component";
import { Host } from "../../base/decorators";
import { Portal } from "../../base/Portal";
import { renderPage } from "../../hydration/ssr";
import { hydrateRoot } from "../../hydration/hydrate";
import { unmountChildrenNodes } from "../../core/DiffAndMerge";
import { PORTAL_ATTR } from "../../helpers/constants";

/**
 * A `Portal` across the server→client boundary.
 *
 * On the SERVER the portal places its children into the target (here
 * `document.head`), and `renderPage` has to collect them — a `renderToString`
 * returns only the body, so a tag a portal put in the head is emitted through the
 * same seam `Head` used, keyed by `PORTAL_ATTR`.
 *
 * On the CLIENT the portal must ADOPT the server's nodes rather than append a
 * second copy — and it must OWN them, so tearing the page down removes exactly
 * what the server wrote. Neither happens for free: hydration runs only the
 * `env: "client"` creates, so `@create({ env: "shared" })` — which places on a
 * normal build — never fires, and the tag the server wrote would be nobody's.
 */
function headPortalTags(): Element[] {
  return [...document.head.querySelectorAll(`[${PORTAL_ATTR}]`)];
}

beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));
afterEach(() => {
  vi.restoreAllMocks();
  for (const tag of headPortalTags()) tag.remove();
  document.title = "";
});

describe("Portal SSR", () => {
  test("renderPage emits a tag the portal placed in the head", async () => {
    class Page extends Component {
      portal = this.use(Portal, {
        children: <meta name="p" content="v" />,
        target: document.head,
      });
      render() {
        return <div>body</div>;
      }
    }

    const page = await renderPage(<Page />);

    // The body is the app markup, and the portal contributed nothing to it …
    expect(page.body).toContain("body");
    expect(page.body).not.toContain('name="p"');
    // … it went to the head, which renderPage collected.
    expect(page.head).toContain('name="p"');
    expect(page.head).toContain('content="v"');
  });
});

describe("Portal hydration", () => {
  test("adopts the server's node instead of duplicating it, and owns it", async () => {
    @Host("div")
    class Page extends Component {
      portal = this.use(Portal, {
        children: <meta name="p" content="v" />,
        target: document.head,
      });
      render() {
        return <p>page</p>;
      }
    }

    // 1. Server render. renderPage resets the head afterwards, so its tags are gone
    //    from this process — exactly as they would be in the browser, a different one.
    const page = await renderPage(<Page />);

    // 2. Reconstruct what the browser receives: the head tags in <head>, the body
    //    in a container to hydrate.
    document.head.insertAdjacentHTML("beforeend", page.head);
    expect(headPortalTags()).toHaveLength(1);

    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = page.body;

    // 3. Hydrate.
    hydrateRoot(<Page />, container);
    await Promise.resolve();

    // Adopted, not appended: still exactly one.
    const metas = [...document.head.querySelectorAll('meta[name="p"]')];
    expect(metas).toHaveLength(1);

    // Owned: tearing the page down takes the server's tag with it.
    unmountChildrenNodes([container as unknown as never]);
    expect(document.head.querySelectorAll('meta[name="p"]')).toHaveLength(0);

    container.remove();
  });

  test("a reactive portal keeps following its source after hydration", async () => {
    @Host("div")
    class Page extends Component {
      count = 0;
      portal = this.use(Portal, (self: Page) => ({
        children: <meta name="c" content={String(self.count)} />,
        target: document.head,
      }));
      render() {
        return <p>page</p>;
      }
    }

    const page = await renderPage(<Page />);
    document.head.insertAdjacentHTML("beforeend", page.head);
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = page.body;

    hydrateRoot(<Page />, container);
    await Promise.resolve();

    // The adopted node is the one that reacts — no second meta appears.
    expect(document.head.querySelectorAll('meta[name="c"]')).toHaveLength(1);

    unmountChildrenNodes([container as unknown as never]);
    container.remove();
  });

  test("two portals into one head both survive SSR and hydration", async () => {
    // Each portal must adopt only ITS OWN server nodes. Seeding from every marked
    // node in the target made the first portal sweep the second's tags away, and the
    // second then rebuilt onto what was left — so one of the two was lost.
    class WithMeta extends Component<{ n: string }> {
      portal = this.use(Portal, (self: WithMeta) => ({
        children: <meta name={self.props.n} content="x" />,
        target: document.head,
      }));
      render() {
        return <p>{this.props.n}</p>;
      }
    }

    @Host("div")
    class Page extends Component {
      render() {
        return (
          <div>
            <WithMeta n="a" />
            <WithMeta n="b" />
          </div>
        );
      }
    }

    const page = await renderPage(<Page />);
    expect(page.head).toContain('name="a"');
    expect(page.head).toContain('name="b"');

    document.head.insertAdjacentHTML("beforeend", page.head);
    // The exact server nodes, so we can prove each was ADOPTED, not swept and rebuilt.
    const serverA = document.head.querySelector('meta[name="a"]');
    const serverB = document.head.querySelector('meta[name="b"]');

    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = page.body;

    hydrateRoot(<Page />, container);
    await Promise.resolve();

    // Both adopted, neither duplicated nor swept.
    expect(document.head.querySelectorAll('meta[name="a"]')).toHaveLength(1);
    expect(document.head.querySelectorAll('meta[name="b"]')).toHaveLength(1);
    // Each portal adopted ITS OWN server node — the second was not swept by the first
    // and rebuilt from scratch (which would lose any state and orphan the server node).
    expect(document.head.querySelector('meta[name="a"]')).toBe(serverA);
    expect(document.head.querySelector('meta[name="b"]')).toBe(serverB);

    // Both owned: tearing the page down takes both with it.
    unmountChildrenNodes([container as unknown as never]);
    expect(document.head.querySelectorAll('meta[name="a"]')).toHaveLength(0);
    expect(document.head.querySelectorAll('meta[name="b"]')).toHaveLength(0);

    container.remove();
  });

  test("a string child does not make a portal over-claim a sibling's nodes", async () => {
    // A string child becomes an UNMARKED text node, so it owns no marked node. If
    // adopt counts total children rather than element children, a portal with a
    // string child claims one node too many — the next portal's — and sweeps it.
    class First extends Component {
      portal = this.use(Portal, {
        children: ["prefix", <meta name="a" content="x" />],
        target: document.head,
      });
      render() {
        return <p>first</p>;
      }
    }
    class Second extends Component {
      portal = this.use(Portal, {
        children: <meta name="b" content="x" />,
        target: document.head,
      });
      render() {
        return <p>second</p>;
      }
    }

    @Host("div")
    class Page extends Component {
      render() {
        return (
          <div>
            <First />
            <Second />
          </div>
        );
      }
    }

    const page = await renderPage(<Page />);
    document.head.insertAdjacentHTML("beforeend", page.head);
    const serverA = document.head.querySelector('meta[name="a"]');
    const serverB = document.head.querySelector('meta[name="b"]');

    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = page.body;

    hydrateRoot(<Page />, container);
    await Promise.resolve();

    // Each portal adopted its OWN meta — the string child did not push the first
    // portal onto the second's node.
    expect(document.head.querySelector('meta[name="a"]')).toBe(serverA);
    expect(document.head.querySelector('meta[name="b"]')).toBe(serverB);

    unmountChildrenNodes([container as unknown as never]);
    container.remove();
  });
});
