import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { Component } from "../../base/Component";
import { state, created } from "../../base/decorators";
import { Portal } from "../../base/Portal";
import { renderPage } from "../../hydration/ssr";
import { hydrateRoot } from "../../hydration/hydrate";
import { findAll } from "../../test/setup";
import { resetDiagnostics } from "../../debug/diagnostics";
import { unmountChildrenNodes } from "../../core/DiffAndMerge";
import { PORTAL_ATTR } from "../../helpers/constants";
import { isOpenAnchor, isCloseAnchor } from "../../core/childrenRegion";

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
 * `env: "client"` creates, so `@created({ env: "shared" })` — which places on a
 * normal build — never fires, and the tag the server wrote would be nobody's.
 */
function headPortalTags(): Element[] {
  return [...document.head.querySelectorAll(`[${PORTAL_ATTR}]`)];
}

/** The blocks a `Portal` wrote, found by the anchor comments that delimit them. */
function headPortalBlocks(): Comment[] {
  return [...document.head.childNodes].filter(isOpenAnchor) as Comment[];
}

/**
 * Everything a portal left in the head, so one test cannot leak into the next.
 *
 * Every anchor comment, matched or not — this is cleanup, and an unmatched one is
 * leftovers rather than a block to respect. `collectHead` is the one that has to
 * tell them apart, and does; see the test at the bottom for why.
 */
function clearPortalBlocks(): void {
  for (const node of [...document.head.childNodes]) {
    if (isOpenAnchor(node) || isCloseAnchor(node)) node.remove();
  }
}

beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));
afterEach(() => {
  vi.restoreAllMocks();
  for (const tag of headPortalTags()) tag.remove();
  clearPortalBlocks();
  document.title = "";
});

describe("Portal SSR", () => {
  test("renderPage emits a tag the portal placed in the head", async () => {
    class Page extends Component {
      portal = this.use(Portal, () => ({
        children: <meta name="p" content="v" />,
        target: document.head,
      }));
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

  test("a portalled subtree that re-renders on the server still reaches the page", async () => {
    // The portal used to mark its own tags with an ATTRIBUTE, and `collectHead`
    // emitted whatever carried it. An attribute cannot survive on a node the
    // reconciler owns: the attribute diff reads a node's current attributes as
    // the previous set and removes whatever the next vnode does not have. So the
    // first re-render of anything in the block erased the marker, and the tag
    // left the page silently — no error, no diagnostic, just a head with nothing
    // in it.
    //
    // Any state write does it. Here a server-only `@created`, which is the
    // ordinary way to fill a tag from data the server has.
    class Badge extends Component {
      @state n = 0;

      @created({ env: "server" })
      fill(): void {
        this.n = 7;
      }

      render() {
        return <meta name="badge" content={String(this.n)} />;
      }
    }

    class Page extends Component {
      portal = this.use(Portal, () => ({ children: <Badge />, target: document.head }));
      render() {
        return <div>body</div>;
      }
    }

    const page = await renderPage(<Page />);

    expect(page.head).toContain('name="badge"');
    expect(page.head).toContain('content="7"');
  });
});

describe("Portal hydration", () => {
  test("adopts the server's node instead of duplicating it, and owns it", async () => {
    class Page extends Component {
      portal = this.use(Portal, () => ({
        children: <meta name="p" content="v" />,
        target: document.head,
      }));
      render() {
        return (
          <div>
            <p>page</p>
          </div>
        );
      }
    }

    // 1. Server render. renderPage resets the head afterwards, so its tags are gone
    //    from this process — exactly as they would be in the browser, a different one.
    const page = await renderPage(<Page />);

    // 2. Reconstruct what the browser receives: the head tags in <head>, the body
    //    in a container to hydrate.
    document.head.insertAdjacentHTML("beforeend", page.head);
    // The server's block, delimited by its region's anchors — not a marker
    // ATTRIBUTE on the tag, which is what this used to look for. An attribute on
    // a node the reconciler owns is erased by the next attribute pass, so a
    // portalled subtree that re-rendered on the server lost it and the tag never
    // reached the page at all.
    expect(headPortalBlocks()).toHaveLength(1);
    expect(document.head.querySelectorAll('meta[name="p"]')).toHaveLength(1);

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
    class Page extends Component {
      count = 0;
      portal = this.use(Portal, (self: Page) => ({
        children: <meta name="c" content={String(self.count)} />,
        target: document.head,
      }));
      render() {
        return (
          <div>
            <p>page</p>
          </div>
        );
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

    class Page extends Component {
      render() {
        return (
          <div>
            <div>
              <WithMeta n="a" />
              <WithMeta n="b" />
            </div>
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
      portal = this.use(Portal, () => ({
        children: ["prefix", <meta name="a" content="x" />],
        target: document.head,
      }));
      render() {
        return <p>first</p>;
      }
    }
    class Second extends Component {
      portal = this.use(Portal, () => ({
        children: <meta name="b" content="x" />,
        target: document.head,
      }));
      render() {
        return <p>second</p>;
      }
    }

    class Page extends Component {
      render() {
        return (
          <div>
            <div>
              <First />
              <Second />
            </div>
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

describe("Portal hydration restores components", () => {
  test("a component inside a portal keeps the state the server gave it", async () => {
    // The portal's block is in a target the main hydration walk never visits, so
    // adopting it used to mean "reuse the element" and nothing more: no node says a component is
    // here, so the reconcile CREATED one against it. A fresh instance means the server's `@created`
    // never ran here and its state is gone — the tag stays, its contents revert.
    //
    // `n` is set by a SERVER-only create, so it can only reach the client through
    // the blob. Reading 0 back means the component was rebuilt, not hydrated.
    let clientCreates = 0;

    class Badge extends Component {
      @state n = 0;

      @created({ env: "server" })
      fill(): void {
        this.n = 7;
      }

      @created({ env: "client" })
      count(): void {
        clientCreates++;
      }

      render() {
        return <meta name="badge" content={String(this.n)} />;
      }
    }

    class Page extends Component {
      portal = this.use(Portal, () => ({
        children: <Badge />,
        target: document.head,
      }));
      render() {
        return <div>body</div>;
      }
    }

    const page = await renderPage(<Page />);
    expect(page.head).toContain('content="7"');

    document.head.insertAdjacentHTML("beforeend", page.head);
    const serverBadge = document.head.querySelector('meta[name="badge"]');

    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = page.body;

    hydrateRoot(<Page />, container);
    await Promise.resolve();

    // Adopted, not replaced.
    expect(document.head.querySelectorAll('meta[name="badge"]')).toHaveLength(1);
    expect(document.head.querySelector('meta[name="badge"]')).toBe(serverBadge);
    // Hydrated: the server's state survived, and the client lifecycle ran once.
    expect(document.head.querySelector('meta[name="badge"]')?.getAttribute("content")).toBe("7");
    expect(clientCreates).toBe(1);

    unmountChildrenNodes([container as unknown as never]);
    container.remove();
  });
});

describe("a comment that only looks like an anchor", () => {
  test("a client render SHORTER than the server's leaves nothing outside the block", async () => {
    /**
     * The third outcome the adoption did not have: the walk stops on a leftover SERVER node that is
     * still INSIDE the block. A fresh close anchor minted in front of it puts every remaining server
     * node — and the server's own close — OUTSIDE the region, where the stale markup stays on screen
     * and `dispose()` can never reach it.
     *
     * This is the same divergence the component path handles in `closeBlock`, one level up.
     */
    let onServer = true;

    class Page extends Component {
      portal = this.use(Portal, () => ({
        children: onServer
          ? [<meta name="a" content="x" />, <meta name="b" content="x" />]
          : [<meta name="a" content="x" />],
        target: document.head,
      }));
      render() {
        return <div>body</div>;
      }
    }

    const page = await renderPage(<Page />);
    document.head.insertAdjacentHTML("beforeend", page.head);
    expect(document.head.querySelectorAll('meta[name="b"]')).toHaveLength(1);

    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = page.body;

    onServer = false;
    hydrateRoot(<Page />, container);
    await Promise.resolve();

    // One block, one close, and the child this render did not ask for is gone rather than stranded.
    expect(headPortalBlocks()).toHaveLength(1);
    expect([...document.head.childNodes].filter(isCloseAnchor)).toHaveLength(1);
    expect(document.head.querySelectorAll('meta[name="a"]')).toHaveLength(1);
    expect(document.head.querySelectorAll('meta[name="b"]')).toHaveLength(0);

    // And what is left is the block's own: the teardown takes it.
    unmountChildrenNodes([container as unknown as never]);
    expect(document.head.querySelectorAll("meta")).toHaveLength(0);
    container.remove();
  });

  test("a hydrated block publishes where it ends, so an empty component lands inside it", async () => {
    /**
     * `BLOCK_CLOSE` on the opening anchor is what tells a reader where a block ends, and two readers
     * need it: the position search an empty component does for its first node, and the host element
     * whose claim pool has to skip the run.
     *
     * On a HYDRATED page it was not published. The adoption published once before the closing anchor
     * was known and only the two divergence exits published again — so the ordinary exit, which is
     * every correct SSR page, left it unset until the region's first `reconcile()`. The fallback for
     * a missing answer is "the end of the target", which is exactly the fault the client-built case
     * pins two tests above.
     */
    class Late extends Component {
      @state shown = false;
      render() {
        return this.shown ? <meta name="late" content="v" /> : null;
      }
    }

    class Page extends Component {
      first = this.use(Portal, () => ({ children: <Late />, target: document.head }));
      second = this.use(Portal, () => ({ children: <meta name="other" content="v" />, target: document.head }));
      render() {
        return <div>body</div>;
      }
    }

    const page = await renderPage(<Page />);
    document.head.insertAdjacentHTML("beforeend", page.head);

    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = page.body;

    hydrateRoot(<Page />, container);
    await Promise.resolve();

    findAll<{ shown: boolean }>(document.head, "Late")[0]!.shown = true;
    await Promise.resolve();
    await Promise.resolve();

    /**
     * Inside the FIRST block's anchors, not appended past the second one. `|` is an anchor, so the
     * shape to read is: open, the node, close, then the second block.
     */
    const shape = [...document.head.childNodes]
      .filter((node) => node.nodeType === 8 || (node as Element).getAttribute?.("name"))
      .map((node) => (node.nodeType === 8 ? "|" : (node as Element).getAttribute("name")))
      .join(",");
    expect(shape).toBe("|,late,|,|,other,|");
    container.remove();
  });

  test("a text divergence inside a block reports one diagnostic, not two", async () => {
    /**
     * A block ends a level of its own, so it has the question `closeBlock` has one level up: the
     * tail of a text repair is the second half of a divergence already reported, and counting it as
     * a node the server sent says "your block is one node shorter" about a node this hydration made.
     *
     * The text is a child of the BLOCK itself rather than of a component inside it — a component
     * ends its own level through `closeBlock`, and this is the level the region ends for itself.
     *
     * Found by walking the callers of the rule rather than by a failure: six places end a level and
     * only one of them had been taught this.
     */
    let onServer = true;

    class Page extends Component {
      portal = this.use(Portal, () => ({
        children: onServer ? "waiting" : "ready",
        target: document.head,
      }));
      render() {
        return <div>body</div>;
      }
    }

    const codes: string[] = [];
    const onLog = (event: Event) => {
      const detail = (event as CustomEvent).detail as { message: string };
      const code = detail.message.match(/^\[(RMD\d+)\]/)?.[1];
      if (code) codes.push(code);
    };

    const page = await renderPage(<Page />);
    document.head.insertAdjacentHTML("beforeend", page.head);

    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = page.body;

    onServer = false;
    // The registry dedupes by code and key across a run, and earlier tests in this file have already
    // reported RMD007 — without this the assertion below passes on a suppressed message.
    resetDiagnostics();
    window.addEventListener("ramonda:dev-log", onLog);
    try {
      hydrateRoot(<Page />, container);
      await Promise.resolve();
    } finally {
      window.removeEventListener("ramonda:dev-log", onLog);
    }

    // One divergence, one message — and the block holds exactly the text this render produced.
    expect(codes).toEqual(["RMD007"]);
    expect(document.head.textContent).toContain("ready");
    expect(document.head.textContent).not.toContain("waiting");
    container.remove();
  });

  test("a block the server never closed is closed by the client that adopts it", async () => {
    /**
     * The closing anchor gone from the served markup — a truncated response, or a sanitizer that
     * strips comments. The walk then has nothing to stop on, and the region has to write its own
     * close before it can insert anything: without one, `reconcile` and `dispose` have no end to
     * work against and the next render puts nodes past every other block in the target.
     */
    class Page extends Component {
      portal = this.use(Portal, () => ({
        children: <meta name="unclosed" content="v" />,
        target: document.head,
      }));
      render() {
        return <div>body</div>;
      }
    }

    const page = await renderPage(<Page />);
    expect(page.head).toMatch(/<!--\/r\d+-->/);
    document.head.insertAdjacentHTML("beforeend", page.head.replace(/<!--\/r\d+-->/, ""));

    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = page.body;

    hydrateRoot(<Page />, container);
    await Promise.resolve();

    // One opening anchor, one closing anchor, and the server's tag between them — adopted, not
    // duplicated.
    expect(headPortalBlocks()).toHaveLength(1);
    expect([...document.head.childNodes].filter(isCloseAnchor)).toHaveLength(1);
    expect(document.head.querySelectorAll('meta[name="unclosed"]')).toHaveLength(1);

    // And the block owns what it adopted: the teardown takes the tag with it.
    unmountChildrenNodes([container as unknown as never]);
    expect(document.head.querySelectorAll('meta[name="unclosed"]')).toHaveLength(0);
    container.remove();
  });

  test("does not swallow the shell's head, or hide a real block", async () => {
    // A portal's block is delimited by comments, and a shell is entitled to have
    // one that reads the same way. Two ways of pairing them were wrong, and both
    // were measured rather than imagined:
    //
    // Counting a running depth — an open that never closes swallowed everything
    // after it, so `resetHead` DELETED the shell's own tags.
    //
    // Pairing with "the next close" — the stray comment took a real block's
    // closing anchor, so the block in between was collected as part of it. And
    // giving up at the first unmatched open hid every real block after it.
    //
    // So an anchor is matched to ITS close, by id, and an unmatched one is
    // ignored while the scan carries on.
    document.head.insertAdjacentHTML("beforeend", '<!--r999--><meta name="shell" content="stays">');

    class Page extends Component {
      portal = this.use(Portal, () => ({
        children: <meta name="mine" content="x" />,
        target: document.head,
      }));
      render() {
        return <div>body</div>;
      }
    }

    const page = await renderPage(<Page />);

    // The shell's tag is untouched, and never claimed as part of a block …
    expect(document.head.innerHTML).toContain('name="shell"');
    expect(page.head).not.toContain('name="shell"');
    // … while the portal's real block is still found and collected.
    expect(page.head).toContain('name="mine"');

    for (const node of [...document.head.childNodes]) {
      if (node.nodeType === 8 || (node as Element).getAttribute?.("name") === "shell") node.remove();
    }
  });
});
