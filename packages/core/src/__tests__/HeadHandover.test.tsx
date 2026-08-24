import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { getDOM, findOne } from "../test/setup";
import { Component } from "../base/Component";
import { state } from "../base/decorators";
import { Head, resetHeadRegistry } from "../base/Head";
import { PORTAL_ATTR } from "../helpers/constants";

/**
 * What happens to the head when one page replaces another.
 *
 * Two `Head` instances exist at once during a swap: the incoming page's `@created`
 * runs before the outgoing page's `@destroyed`. While each held its own list of
 * elements to remove on the way out, that overlap was a race — the incoming page
 * adopted the element, the outgoing page still had it listed, and its teardown took
 * it out of the document. Ownership decided by two objects independently makes a
 * handover a race rather than an agreement.
 *
 * One registry per document owns the elements now, and it recomputes the head from
 * whichever entries are currently published — so the outcome does not depend on
 * which of the two lifecycles ran first.
 */
describe("the head when one page replaces another", () => {
  beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));
  afterEach(() => {
    vi.restoreAllMocks();
    resetHeadRegistry();
    for (const tag of [...document.head.querySelectorAll(`[${PORTAL_ATTR}]`)]) tag.remove();
    document.title = "";
  });

  const description = () => document.head.querySelector('meta[name="description"]');

  test("the incoming page's description survives the outgoing page's teardown", async () => {
    /**
     * Both pages describe themselves, so both reach for the SAME element —
     * `<meta name="description">` is identified by its name, and there is one.
     *
     * The incoming page finds it and adopts it. The outgoing page still has it in
     * its own list, and takes it out of the document on its way past. The reader
     * is left on a page that described itself and has no description.
     */
    class Home extends Component {
      head = this.use(Head, () => ({ title: "Home", description: "the home page" }));
      render() {
        return (
          <div>
            <p>home</p>
          </div>
        );
      }
    }

    class About extends Component {
      head = this.use(Head, () => ({ title: "About", description: "who we are" }));
      render() {
        return (
          <div>
            <p>about</p>
          </div>
        );
      }
    }

    class App extends Component {
      @state route = "home";
      render() {
        return <div>{this.route === "home" ? <Home /> : <About />}</div>;
      }
    }

    const app = await getDOM<App>(<App />);
    await app.settle();
    expect(description()!.getAttribute("content")).toBe("the home page");

    app.instance.route = "about";
    await app.settle();

    expect(document.title).toBe("About");
    expect(description()).not.toBeNull();
    expect(description()!.getAttribute("content")).toBe("who we are");
  });

  test("and a link the two pages share is not taken away either", async () => {
    class Home extends Component {
      head = this.use(Head, () => ({
        title: "Home",
        link: [{ rel: "icon", href: "/favicon.ico" }],
      }));
      render() {
        return (
          <div>
            <p>home</p>
          </div>
        );
      }
    }

    class About extends Component {
      head = this.use(Head, () => ({
        title: "About",
        link: [{ rel: "icon", href: "/favicon.ico" }],
      }));
      render() {
        return (
          <div>
            <p>about</p>
          </div>
        );
      }
    }

    class App extends Component {
      @state route = "home";
      render() {
        return <div>{this.route === "home" ? <Home /> : <About />}</div>;
      }
    }

    const app = await getDOM<App>(<App />);
    await app.settle();
    expect(document.head.querySelectorAll('link[rel="icon"]')).toHaveLength(1);

    app.instance.route = "about";
    await app.settle();

    expect(document.head.querySelectorAll('link[rel="icon"]')).toHaveLength(1);
  });

  test("a wrapper between two Heads changes nothing", async () => {
    /**
     * The reason the chain is built from `Head`s and not from component depth.
     *
     * Component depth counts everything — a guard, a provider, a presentational
     * shell — so wrapping a route in something that has nothing to do with the head
     * would have moved it a level down and let it beat a page it is not actually
     * nested under. Which page owns the title would have been decided by incidental
     * nesting, and adding a wrapper to one branch would silently change the answer
     * for the other.
     *
     * Each `Head` leaves itself on its own CONTEXT, and a component's context is
     * `Object.create(parentContext)`. A component that publishes nothing writes
     * nothing, so a descendant inherits the nearest `Head` above it however many
     * components apart the two are.
     */
    class Deep extends Component {
      head = this.use(Head, () => ({ description: "the deep page" }));
      render() {
        return (
          <div>
            <p>deep</p>
          </div>
        );
      }
    }

    // Three components with no Head at all between the layout and the page.
    class Guard extends Component {
      render() {
        return (
          <div>
            <Shell />
          </div>
        );
      }
    }
    class Shell extends Component {
      render() {
        return (
          <div>
            <Frame />
          </div>
        );
      }
    }
    class Frame extends Component {
      render() {
        return (
          <div>
            <Deep />
          </div>
        );
      }
    }

    class Layout extends Component {
      head = this.use(Head, () => ({ title: "Layout", description: "the layout" }));
      render() {
        return (
          <div>
            <Guard />
          </div>
        );
      }
    }

    const app = await getDOM(<Layout />);
    await app.settle();

    // The page below wins the description; the layout still supplies the title it
    // alone sets. Exactly what it would be with the wrappers taken out.
    expect(description()!.getAttribute("content")).toBe("the deep page");
    expect(document.title).toBe("Layout");
  });

  test("a whole tree of Heads writes the document once, at the end", async () => {
    /**
     * Why the recompute is deferred to the commit rather than done per publication.
     *
     * Every `Head` publishes during its own `@created`, and the head the document
     * should have is a function of ALL of them. Applying as each one publishes does
     * the work once per page in the chain and — worse — walks the document through
     * states no commit ever meant to show: the layout's title, then the section's,
     * then the page's, in the same frame.
     *
     * Counted by watching `document.title` itself, so it measures what a reader
     * could see rather than which function was called.
     */
    const titles: string[] = [];
    const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, "title");

    class Page extends Component {
      head = this.use(Head, () => ({ title: "Page" }));
      render() {
        return (
          <div>
            <p>page</p>
          </div>
        );
      }
    }
    class Section extends Component {
      head = this.use(Head, () => ({ title: "Section" }));
      render() {
        return (
          <div>
            <Page />
          </div>
        );
      }
    }
    class Layout extends Component {
      head = this.use(Head, () => ({ title: "Layout" }));
      render() {
        return (
          <div>
            <Section />
          </div>
        );
      }
    }

    Object.defineProperty(document, "title", {
      configurable: true,
      get: () => descriptor!.get!.call(document),
      set: (value: string) => {
        titles.push(value);
        descriptor!.set!.call(document, value);
      },
    });

    try {
      const app = await getDOM(<Layout />);
      await app.settle();
    } finally {
      delete (document as unknown as Record<string, unknown>).title;
    }

    // One write, and it is the innermost page's — not "Layout", then "Section",
    // then "Page".
    expect(titles).toEqual(["Page"]);
  });

  test("three Heads, different tags, one overriding another — merged per TAG", async () => {
    /**
     * The chain decides who wins a tag, not whether a tag survives at all.
     *
     * Resolution walks outermost to innermost collecting tags by the thing that
     * identifies each one, so a deeper `Head` replaces only the tags it actually
     * names. Everything an ancestor set and nobody overrode stays exactly where it
     * was. What makes that hold under change is that the answer is recomputed from
     * the chain each time rather than patched — there is no accumulated state to go
     * stale, so no write can leave a tag behind that nothing asks for.
     */
    class Page extends Component {
      head = this.use(Head, () => ({
        description: "the page",
        meta: [{ property: "og:title", content: "page og" }],
      }));
      render() {
        return (
          <div>
            <p>page</p>
          </div>
        );
      }
    }

    class Section extends Component {
      head = this.use(Head, () => ({
        meta: [
          { property: "og:title", content: "section og" },
          { name: "robots", content: "noindex" },
        ],
      }));
      render() {
        return (
          <div>
            <Page />
          </div>
        );
      }
    }

    class Layout extends Component {
      head = this.use(Head, () => ({
        title: "Site",
        description: "the site",
        meta: [{ name: "viewport", content: "width=device-width" }],
      }));
      render() {
        return (
          <div>
            <Section />
          </div>
        );
      }
    }

    const app = await getDOM(<Layout />);
    await app.settle();

    const content = (selector: string) => document.head.querySelector(selector)?.getAttribute("content");

    // Overridden by the deepest that names it.
    expect(content('meta[name="description"]')).toBe("the page");
    expect(content('meta[property="og:title"]')).toBe("page og");
    // Set once, nobody overrode it — untouched at every level.
    expect(content('meta[name="viewport"]')).toBe("width=device-width");
    expect(content('meta[name="robots"]')).toBe("noindex");
    // The title came from the only one that set it.
    expect(document.title).toBe("Site");

    // And exactly one element per identity, not one per contributor.
    expect(document.head.querySelectorAll('meta[property="og:title"]')).toHaveLength(1);
    expect(document.head.querySelectorAll('meta[name="description"]')).toHaveLength(1);
  });

  test("a Head dropping its own tag does not take anyone else's with it", async () => {
    /**
     * The specific fear: a write in one place reaching into another. Removing a
     * title has to leave every description alone, and a page that stops setting
     * `og:title` has to hand it back to whoever set it above rather than delete it.
     */
    class Page extends Component {
      @state loud = true;
      head = this.use(Head, () =>
        this.loud
          ? { title: "Page", meta: [{ property: "og:title", content: "page og" }] }
          : { description: "still here" },
      );
      render() {
        return (
          <div>
            <p>page</p>
          </div>
        );
      }
    }

    class Layout extends Component {
      head = this.use(Head, () => ({
        title: "Site",
        description: "the site",
        meta: [{ property: "og:title", content: "site og" }],
      }));
      render() {
        return (
          <div>
            <Page />
          </div>
        );
      }
    }

    const app = await getDOM(<Layout />);
    await app.settle();

    expect(document.title).toBe("Page");
    expect(document.head.querySelector('meta[property="og:title"]')!.getAttribute("content")).toBe("page og");

    // The page stops setting both, and starts setting a description.
    findOne<{ loud: boolean }>(app.container, "Page").loud = false;
    await app.settle();

    // Handed back to the layout, not deleted.
    expect(document.title).toBe("Site");
    expect(document.head.querySelector('meta[property="og:title"]')!.getAttribute("content")).toBe("site og");
    // And the page's own new tag won, without disturbing the layout's viewport.
    expect(document.head.querySelector('meta[name="description"]')!.getAttribute("content")).toBe("still here");
  });

  test("an attribute a tag stops asking for comes OFF it", async () => {
    /**
     * The upsert only ever set attributes, so one a page stopped passing stayed on
     * the element for the life of the document. A `<link rel="alternate">` that
     * dropped its `hreflang` went on telling a crawler the page is in English —
     * metadata that is not merely stale but was never true of the page showing.
     *
     * The resolved tag is the whole truth about what its element should carry, so
     * anything else on it is left over. `data-ramonda-portal` survives, because it is
     * not part of the tag's meaning.
     */
    class Page extends Component {
      @state full = true;
      head = this.use(Head, () =>
        this.full
          ? { link: [{ rel: "alternate", href: "/a", hreflang: "en", type: "text/html" }] }
          : { link: [{ rel: "alternate", href: "/a" }] },
      );
      render() {
        return (
          <div>
            <p>x</p>
          </div>
        );
      }
    }

    const app = await getDOM<Page>(<Page />);
    await app.settle();

    const link = () => document.head.querySelector('link[rel="alternate"]')!;
    expect(link().getAttribute("hreflang")).toBe("en");

    app.instance.full = false;
    await app.settle();

    expect(link().getAttribute("hreflang")).toBeNull();
    expect(link().getAttribute("type")).toBeNull();
    expect(link().getAttribute("href")).toBe("/a");
    expect(link().hasAttribute(PORTAL_ATTR)).toBe(true);
  });

  test("a tag something else deleted comes back on the next change", async () => {
    /**
     * Remembering an element is not the same as owning one. An extension, an
     * analytics snippet, anything writing `document.head.innerHTML` can take a tag
     * out — and then every later update wrote attributes onto a DETACHED node. The
     * page had no description, nothing said so, and the next write did not fix it
     * either, because the registry went on believing it had one.
     */
    class Page extends Component {
      @state version = 1;
      head = this.use(Head, () => ({ description: `v${this.version}` }));
      render() {
        return (
          <div>
            <p>x</p>
          </div>
        );
      }
    }

    const app = await getDOM<Page>(<Page />);
    await app.settle();
    expect(description()!.getAttribute("content")).toBe("v1");

    // Something that is not Ramonda removes it.
    description()!.remove();

    app.instance.version = 2;
    await app.settle();

    expect(description()).not.toBeNull();
    expect(description()!.getAttribute("content")).toBe("v2");
  });

  test("what the last page owned still goes when nothing replaces it", async () => {
    class Page extends Component {
      head = this.use(Head, () => ({ title: "Page", description: "only page" }));
      render() {
        return (
          <div>
            <p>page</p>
          </div>
        );
      }
    }

    class App extends Component {
      @state show = true;
      render() {
        return <div>{this.show ? <Page /> : <i>gone</i>}</div>;
      }
    }

    document.title = "before";
    const app = await getDOM<App>(<App />);
    await app.settle();
    expect(description()).not.toBeNull();

    app.instance.show = false;
    await app.settle();

    expect(description()).toBeNull();
    expect(document.title).toBe("before");
  });

  test("two live sibling Heads both contribute — neither drops the other", async () => {
    /**
     * The case a CHAIN cannot represent, and the reason for the tree.
     *
     * A layout with a sidebar and a main area, each with its own `Head`, both ALIVE
     * at once. In context terms they are SIBLINGS — both read the layout's `Head` as
     * their parent, neither is nested under the other. This is not a page swap: no one
     * is leaving.
     *
     * A single-slot chain (`parent.child = entry`) lets the later publisher overwrite
     * the earlier, so the sidebar's tags are dropped the moment the main area's `Head`
     * publishes — while the sidebar is still on screen. A tree keeps both children and
     * merges per tag: different tags coexist, and only a genuine conflict is resolved.
     */
    class Sidebar extends Component {
      head = this.use(Head, () => ({ meta: [{ name: "sidebar", content: "s" }] }));
      render() {
        return (
          <aside>
            <span>side</span>
          </aside>
        );
      }
    }

    class Main extends Component {
      head = this.use(Head, () => ({ title: "Main", meta: [{ name: "main", content: "m" }] }));
      render() {
        return (
          <main>
            <span>main</span>
          </main>
        );
      }
    }

    class Layout extends Component {
      head = this.use(Head, () => ({ title: "Layout", description: "the layout" }));
      render() {
        return (
          <div>
            <div>
              <Sidebar />
              <Main />
            </div>
          </div>
        );
      }
    }

    const app = await getDOM<Layout>(<Layout />);
    await app.settle();

    // Both siblings' own tags are present — neither overwrote the other.
    expect(document.head.querySelector('meta[name="sidebar"]')?.getAttribute("content")).toBe("s");
    expect(document.head.querySelector('meta[name="main"]')?.getAttribute("content")).toBe("m");

    // The layout's description (no sibling sets one) survives …
    expect(description()!.getAttribute("content")).toBe("the layout");
    // … and the deeper title wins over the layout's.
    expect(document.title).toBe("Main");
  });
});
