import { describe, test, expect, beforeEach } from "vitest";
import { Component } from "../base/Component";
import { Head, resetHeadRegistry } from "../base/Head";
import { state } from "../base/decorators";
import { renderPage, renderToString } from "../hydration/ssr";
import { hydrateRoot } from "../hydration/hydrate";
import { PORTAL_ATTR } from "../helpers/constants";
import { getDOM } from "../test/setup";

/**
 * `Head` exists for one reason: a set of pages that all carry the same title and
 * no description competes with itself in search, and the crawlers that do not run
 * JavaScript — most of them, including the ones feeding AI assistants — see only
 * what is in the served HTML.
 *
 * So the tests that matter are the SERVER ones. A head hook that works only after
 * hydration has solved nothing.
 */

function headTags(): Element[] {
  return Array.from(document.head.querySelectorAll(`[${PORTAL_ATTR}]`));
}

beforeEach(() => {
  // The registry lives as long as the document, which is right for a page and
  // wrong for a file of tests that share one.
  resetHeadRegistry();
  for (const tag of headTags()) tag.remove();
  document.title = "";
});

describe("Head on the client", () => {
  test("sets the title and the description", async () => {
    class Page extends Component {
      head = this.use(Head, () => ({
        title: "State — Ramonda",
        description: "How @state turns a class field into a signal.",
      }));
      render() {
        return <article>body</article>;
      }
    }

    await getDOM(<Page />);

    expect(document.title).toBe("State — Ramonda");
    expect(document.head.querySelector('meta[name="description"]')?.getAttribute("content")).toBe(
      "How @state turns a class field into a signal.",
    );
  });

  test("follows a reactive title rather than freezing the first one", async () => {
    class Page extends Component {
      @state section = "State";
      head = this.use(Head, (self: Page) => ({
        title: `${self.section} — Ramonda`,
      }));
      render() {
        return <article>{this.section}</article>;
      }
    }

    const { instance, settle } = await getDOM<Page>(<Page />);
    expect(document.title).toBe("State — Ramonda");

    instance.section = "Effects";
    await settle();

    // A decorator could not do this: the value is computed, not literal.
    expect(document.title).toBe("Effects — Ramonda");
  });

  test("a deeper Head wins, because it applies later", async () => {
    class Inner extends Component {
      head = this.use(Head, () => ({ title: "Inner" }));
      render() {
        return <span>inner</span>;
      }
    }
    class Layout extends Component {
      head = this.use(Head, () => ({ title: "Layout default" }));
      render() {
        return (
          <div>
            <Inner />
          </div>
        );
      }
    }

    await getDOM(<Layout />);

    // Render order is parent before child, so the route beats the shell without
    // anything having to arbitrate.
    expect(document.title).toBe("Inner");
  });

  test("updating does not duplicate a tag", async () => {
    class Page extends Component {
      @state n = 1;
      head = this.use(Head, (self: Page) => ({
        description: `count ${self.n}`,
      }));
      render() {
        return <p>{this.n}</p>;
      }
    }

    const { instance, settle } = await getDOM<Page>(<Page />);
    instance.n = 2;
    await settle();
    instance.n = 3;
    await settle();

    const descriptions = document.head.querySelectorAll('meta[name="description"]');
    expect(descriptions.length).toBe(1);
    expect(descriptions[0]?.getAttribute("content")).toBe("count 3");
  });

  test("removes its own tags on unmount", async () => {
    class Page extends Component {
      head = this.use(Head, () => ({
        title: "Page",
        description: "gone soon",
        link: [{ rel: "canonical", href: "https://example.com/page" }],
      }));
      render() {
        return <p>page</p>;
      }
    }

    const { unmount } = await getDOM(<Page />);
    expect(headTags().length).toBe(2);

    unmount();

    // A route swap that left the previous page's canonical URL behind would tell
    // a crawler two pages are the same one.
    expect(headTags().length).toBe(0);
  });

  test("restores the previous title, but only if it is still the one showing", async () => {
    document.title = "Ramonda";

    class Page extends Component {
      head = this.use(Head, () => ({ title: "Guide" }));
      render() {
        return <p>guide</p>;
      }
    }

    const { unmount } = await getDOM(<Page />);
    expect(document.title).toBe("Guide");

    unmount();
    expect(document.title).toBe("Ramonda");
  });

  test("does not undo a title someone else has since set", async () => {
    class Page extends Component {
      head = this.use(Head, () => ({ title: "First" }));
      render() {
        return <p>first</p>;
      }
    }

    const { unmount } = await getDOM(<Page />);
    expect(document.title).toBe("First");

    // Stands in for the next route's Head, which mounts before this one is torn
    // down. Restoring here would clobber a live page's title.
    document.title = "Second";
    unmount();

    expect(document.title).toBe("Second");
  });

  test("a meta with nothing to identify it is skipped, not duplicated", async () => {
    class Page extends Component {
      @state n = 1;
      // @ts-expect-error — TypeScript rejects a meta with no name/property/
      // http-equiv, which is the first line of defence. This test is about the
      // second: what happens when the code reaches the runtime anyway.
      head = this.use(Head, (self: Page) => ({
        meta: [{ content: `no key ${self.n}` }],
      }));
      render() {
        return <p>{this.n}</p>;
      }
    }

    const { instance, settle } = await getDOM<Page>(<Page />);
    instance.n = 2;
    await settle();

    // Without a name/property/http-equiv there is no way to find the tag again,
    // so every update would append another one.
    expect(headTags().length).toBe(0);
  });

  test('a meta with an identity but no content does not emit content="undefined"', async () => {
    class Page extends Component {
      // @ts-expect-error — `content` is required by the type; this is the runtime
      // guard for a JS caller that omits it.
      head = this.use(Head, () => ({ meta: [{ name: "robots" }] }));
      render() {
        return <p>page</p>;
      }
    }

    await getDOM(<Page />);

    const robots = document.head.querySelector('meta[name="robots"]');
    expect(robots).not.toBeNull();
    // `content` stringified from undefined would ship `content="undefined"`.
    expect(robots?.hasAttribute("content")).toBe(false);
  });
});

describe("Head on the server — the reason it exists", () => {
  test("renderPage returns the title and tags alongside the body", async () => {
    class Page extends Component {
      head = this.use(Head, () => ({
        title: "Get started — Ramonda",
        description: "Install Ramonda and render your first component.",
        meta: [{ property: "og:type", content: "article" }],
        link: [{ rel: "canonical", href: "https://ramonda.dev/start" }],
      }));
      render() {
        return <article>Install it.</article>;
      }
    }

    const page = await renderPage(<Page />);

    expect(page.title).toBe("Get started — Ramonda");
    expect(page.body).toContain("Install it.");
    expect(page.head).toContain('name="description"');
    expect(page.head).toContain('content="Install Ramonda');
    expect(page.head).toContain('property="og:type"');
    expect(page.head).toContain('rel="canonical"');
  });

  test("each page gets its own head — the build loop does not accumulate", async () => {
    class First extends Component {
      head = this.use(Head, () => ({ title: "First", description: "one" }));
      render() {
        return <p>first</p>;
      }
    }
    class Second extends Component {
      head = this.use(Head, () => ({ title: "Second", description: "two" }));
      render() {
        return <p>second</p>;
      }
    }

    const first = await renderPage(<First />);
    const second = await renderPage(<Second />);

    // The failure this guards: a static build renders every page into ONE DOM,
    // so without a reset page two would carry page one's tags — and every page
    // after the first would claim two descriptions.
    expect(second.title).toBe("Second");
    expect(second.head).toContain("two");
    expect(second.head).not.toContain("one");
    expect(first.head).toContain("one");
  });

  test("a render that throws leaves nothing behind — teardown already cleared it", async () => {
    class Broken extends Component {
      head = this.use(Head, () => ({ title: "Broken", description: "should vanish" }));
      render(): never {
        throw new Error("render failed");
      }
    }

    await expect(renderToString(<Broken />)).rejects.toThrow("render failed");

    // Measured, and NOT what an earlier version of this test claimed. The reset
    // in renderPage is not what covers a throw: a failed build runs the tree's
    // @destroyed callbacks, and Head's removes its own tags and restores the
    // title. So even bare renderToString — which has no reset at all — comes
    // back clean.
    expect(headTags().length).toBe(0);
    expect(document.title).toBe("");
  });

  test("the reset BEFORE the render is what isolates it from renderToString", async () => {
    // Distinct KEYS on purpose. A first version of this test gave both pages a
    // `description`, and it passed with the reset removed — because the upsert
    // simply overwrote the one tag. That proved the upsert works, not the reset.
    // A tag the second page never mentions is the only thing that discriminates.
    class Bare extends Component {
      head = this.use(Head, () => ({
        meta: [{ property: "og:title", content: "left behind" }],
      }));
      render() {
        return <p>bare</p>;
      }
    }
    class Next extends Component {
      head = this.use(Head, () => ({ title: "Next", description: "mine" }));
      render() {
        return <p>next</p>;
      }
    }

    // renderToString has no reset of its own, so this genuinely leaves a tag in
    // the document — measured: 1 tag, title "Bare".
    await renderToString(<Bare />);
    expect(headTags().length).toBe(1);

    const next = await renderPage(<Next />);

    // Without the up-front reset, the second page would ship the first page's
    // description — two descriptions on one page, which is exactly the defect
    // Head exists to prevent.
    expect(next.head).not.toContain("left behind");
    expect(next.head).toContain("mine");
  });

  test("escapes a value that would otherwise break out of the attribute", async () => {
    class Page extends Component {
      head = this.use(Head, () => ({
        description: `He said "hello" & <left>`,
      }));
      render() {
        return <p>x</p>;
      }
    }

    const page = await renderPage(<Page />);

    // setAttribute + outerHTML, never string concatenation: a description is
    // page content, and page content can be anything.
    //
    // The QUOTE is the breakout character, and it is escaped. `<` and `>` are
    // not — they are legal unescaped inside a quoted attribute value, and the
    // HTML serializer deliberately leaves them. A first version of this test
    // asserted `&lt;left&gt;` and failed against correct output; the assertion
    // was wrong, not the escaping.
    expect(page.head).toContain("&quot;hello&quot;");
    expect(page.head).toContain("&amp;");

    // The real check: parse it back and confirm the value survived intact and
    // the attribute did not terminate early.
    const parsed = document.createElement("div");
    parsed.innerHTML = page.head.replace(/^<meta/, "<meta");
    expect(parsed.querySelector('meta[name="description"]')?.getAttribute("content")).toBe(`He said "hello" & <left>`);
  });
});

describe("Head through hydration", () => {
  test("adopts the server's tags instead of adding a second copy", async () => {
    class Page extends Component {
      head = this.use(Head, () => ({
        title: "Hydrated",
        description: "written once",
      }));
      render() {
        return <p>page</p>;
      }
    }

    const page = await renderPage(<Page />);

    // Put the server's head into the document, the way the served HTML would.
    document.head.insertAdjacentHTML("beforeend", page.head);
    document.title = page.title;
    expect(headTags().length).toBe(1);

    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = page.body;
    hydrateRoot(<Page />, container);
    await Promise.resolve();

    // The upsert found the server's meta and updated it in place. Appending
    // instead would give every hydrated page two descriptions — which search
    // engines treat as a defect, and which grows on every navigation.
    expect(document.head.querySelectorAll('meta[name="description"]').length).toBe(1);
    expect(document.title).toBe("Hydrated");

    container.remove();
  });
});

describe("renderToString is unchanged", () => {
  test("still returns just the body", async () => {
    class Page extends Component {
      head = this.use(Head, () => ({ title: "Body only" }));
      render() {
        return <p>body</p>;
      }
    }

    const html = await renderToString(<Page />);
    expect(html).toContain("body");
    expect(html).not.toContain("<meta");
  });
});

/**
 * `meta` and `link` arrive as fresh array literals on every evaluation of a call site's callback,
 * and every prop is a signal comparing by reference. The class declares them values with
 * `@StableProps`, and that declaration is what keeps the head from republishing on renders that
 * changed nothing it owns.
 *
 * Written because the alternative is silent: remove the declaration and every test above still
 * passes — the head ends up CORRECT, just rebuilt on every render of whatever mounted it.
 */
describe("a render that changed nothing the head owns", () => {
  test("does not republish, even though the arrays are rebuilt", async () => {
    let applies = 0;
    const seen = new Set<string>();

    class Page extends Component {
      @state tick = 0;
      head = this.use(Head, (self: Page) => {
        // Read a value the head does NOT own, so the callback re-evaluates on every render the
        // way a real page's does — a title built from props, a description from a signal.
        void self.tick;
        return {
          title: "Fixed",
          meta: [{ name: "robots", content: "index,follow" }],
          link: [{ rel: "icon", href: "/favicon.ico" }],
        };
      });
      render() {
        return <span>{this.tick}</span>;
      }
    }

    const { instance, settle } = await getDOM<Page>(<Page />);

    // The observable effect of a republish: the title element is written again. Counting writes
    // rather than internal calls, so this stays a test of behaviour.
    const title = document.querySelector("title");
    const observer = new MutationObserver((records) => {
      applies += records.length;
      for (const r of records) seen.add(r.type);
    });
    if (title) observer.observe(title, { childList: true, characterData: true, subtree: true });
    observer.observe(document.head, { childList: true });

    for (let i = 1; i <= 5; i++) {
      instance.tick = i;
      await settle();
    }
    observer.disconnect();

    expect(applies, `head was touched ${applies} time(s) by renders that changed nothing`).toBe(0);
    expect(document.title).toBe("Fixed");
  });
});

/**
 * A tag the page author wrote in `index.html`, and what is left of it afterwards.
 *
 * The registry adopts a matching element rather than adding a second one beside it — right, and
 * the reason a page with its own `<meta name="description">` does not end up with two. But it then
 * REMOVED that element on unmount, whether it had created it or merely borrowed it, so a
 * hand-written tag disappeared from the document and never came back.
 *
 * `title` has always done the other thing: `originalTitle` is captured when the registry is made
 * and put back when no page claims one. The tags simply never got the same treatment, and the
 * asymmetry is what makes this a fault rather than a design — measured before it was fixed, a
 * `<title>` came back as `from index.html` while the description beside it was gone.
 *
 * The guard is the title's, for the title's reason: go back only if what is in the document is
 * still what this registry wrote. Something else may own it by now.
 */
describe("a head tag the document already had", () => {
  test("is given back, not deleted, when no page asks for it any more", async () => {
    resetHeadRegistry();
    document.head.innerHTML =
      '<meta name="description" content="from index.html"><link rel="icon" href="/favicon.ico">';
    const theirMeta = document.head.querySelector("meta[name=description]");
    const theirLink = document.head.querySelector("link[rel=icon]");

    class Page extends Component {
      head = this.use(Head, () => ({
        description: "set by the page",
        // The SAME href the document already had, which is the ordinary case: a shell declares the
        // favicon and the app declares it too. A link is identified by its `href`, so a different
        // one is a different link and nothing is adopted.
        link: [{ rel: "icon", href: "/favicon.ico" }],
      }));
      render() {
        return <span>page</span>;
      }
    }

    const { unmount } = await getDOM<Page>(<Page />);

    // Adopted, not duplicated — the thing that was already right.
    expect(document.head.querySelectorAll("meta[name=description]")).toHaveLength(1);
    expect(document.head.querySelector("meta[name=description]")).toBe(theirMeta);
    expect(theirMeta?.getAttribute("content")).toBe("set by the page");
    expect(document.head.querySelectorAll("link[rel=icon]")).toHaveLength(1);
    expect(document.head.querySelector("link[rel=icon]")).toBe(theirLink);

    unmount?.();
    await Promise.resolve();

    expect(document.head.querySelector("meta[name=description]")?.getAttribute("content")).toBe("from index.html");
    expect(document.head.querySelector("link[rel=icon]")?.getAttribute("href")).toBe("/favicon.ico");
  });

  test("a tag the page INVENTED still goes", async () => {
    // The other half, and the reason this is not "never remove anything": a tag nothing in the
    // document had before must not outlive the page that asked for it.
    resetHeadRegistry();
    document.head.innerHTML = "";

    class Page extends Component {
      head = this.use(Head, () => ({ meta: [{ property: "og:title", content: "ours alone" }] }));
      render() {
        return <span>page</span>;
      }
    }

    const { unmount } = await getDOM<Page>(<Page />);
    expect(document.head.querySelector('meta[property="og:title"]')).not.toBeNull();

    unmount?.();
    await Promise.resolve();
    expect(document.head.querySelector('meta[property="og:title"]')).toBeNull();
  });
});

/**
 * The two ways giving a tag back can go wrong, both found reviewing the change that added it.
 *
 * `title` guards against the first and says why: the document's title may have been set by
 * something that is not a `Head` at all — an analytics script, a notification counter — and
 * "restoring" over that undoes a live value nobody asked us to touch. A tag is no different, and
 * the first version of the restore carried only half of the title's logic.
 */
describe("giving a tag back, when the document moved underneath", () => {
  test("does not overwrite a value something else wrote", async () => {
    resetHeadRegistry();
    document.head.innerHTML = '<meta name="description" content="from index.html">';

    class Page extends Component {
      head = this.use(Head, () => ({ description: "set by the page" }));
      render() {
        return <span>x</span>;
      }
    }
    const { unmount } = await getDOM<Page>(<Page />);

    // Not a Head: a script that owns this tag now.
    document.head.querySelector("meta[name=description]")?.setAttribute("content", "written by someone else");

    unmount?.();
    await Promise.resolve();

    // Left alone. Handing back what the document had would undo a live value.
    expect(document.head.querySelector("meta[name=description]")?.getAttribute("content")).toBe(
      "written by someone else",
    );
  });

  test("a tag REBUILT after an external delete is removed, not handed to the author", async () => {
    // The element the author wrote is gone — something deleted it. What stands in its place was
    // built by this registry, so it belongs to the page and must go with it. Restoring the old
    // attributes onto it would leave a tag in the document that nothing put there.
    resetHeadRegistry();
    document.head.innerHTML = '<meta name="description" content="from index.html">';

    class Page extends Component {
      head = this.use(Head, () => ({ description: "set by the page" }));
      render() {
        return <span>x</span>;
      }
    }

    const first = await getDOM<Page>(<Page />);
    document.head.querySelector("meta[name=description]")?.remove();

    const second = await getDOM<Page>(<Page />);
    first.unmount?.();
    second.unmount?.();
    await Promise.resolve();

    expect(document.head.querySelector("meta[name=description]")).toBeNull();
  });
});
