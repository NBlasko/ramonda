import { describe, test, expect, beforeEach } from "vitest";
import { Component } from "../base/Component";
import { Head } from "../base/Head";
import { state } from "../base/decorators";
import { renderPage, renderToString } from "../hydration/ssr";
import { hydrateRoot } from "../hydration/hydrate";
import { HEAD_ATTR } from "../helpers/constants";
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
  return Array.from(document.head.querySelectorAll(`[${HEAD_ATTR}]`));
}

beforeEach(() => {
  for (const tag of headTags()) tag.remove();
  document.title = "";
});

describe("Head on the client", () => {
  test("sets the title and the description", async () => {
    class Page extends Component {
      head = this.use(Head, {
        title: "State — Ramonda",
        description: "How @state turns a class field into a signal.",
      });
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
      head = this.use(Head, { title: "Inner" });
      render() {
        return <span>inner</span>;
      }
    }
    class Layout extends Component {
      head = this.use(Head, { title: "Layout default" });
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
      head = this.use(Head, {
        title: "Page",
        description: "gone soon",
        link: [{ rel: "canonical", href: "https://example.com/page" }],
      });
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
      head = this.use(Head, { title: "Guide" });
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
      head = this.use(Head, { title: "First" });
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
});

describe("Head on the server — the reason it exists", () => {
  test("renderPage returns the title and tags alongside the body", async () => {
    class Page extends Component {
      head = this.use(Head, {
        title: "Get started — Ramonda",
        description: "Install Ramonda and render your first component.",
        meta: [{ property: "og:type", content: "article" }],
        link: [{ rel: "canonical", href: "https://ramonda.dev/start" }],
      });
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
      head = this.use(Head, { title: "First", description: "one" });
      render() {
        return <p>first</p>;
      }
    }
    class Second extends Component {
      head = this.use(Head, { title: "Second", description: "two" });
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
      head = this.use(Head, { title: "Broken", description: "should vanish" });
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
      head = this.use(Head, {
        meta: [{ property: "og:title", content: "left behind" }],
      });
      render() {
        return <p>bare</p>;
      }
    }
    class Next extends Component {
      head = this.use(Head, { title: "Next", description: "mine" });
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
      head = this.use(Head, {
        description: `He said "hello" & <left>`,
      });
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
      head = this.use(Head, {
        title: "Hydrated",
        description: "written once",
      });
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
      head = this.use(Head, { title: "Body only" });
      render() {
        return <p>body</p>;
      }
    }

    const html = await renderToString(<Page />);
    expect(html).toContain("body");
    expect(html).not.toContain("<meta");
  });
});
