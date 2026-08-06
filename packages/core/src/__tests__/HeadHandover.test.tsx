import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { getDOM } from "../test/setup";
import { Component } from "../base/Component";
import { Host, state } from "../base/decorators";
import { Head, resetHeadRegistry } from "../base/Head";
import { HEAD_ATTR } from "../helpers/constants";

/**
 * What happens to the head when one page replaces another.
 *
 * Two `Head` instances exist at once during a swap: the incoming page's `@create`
 * runs before the outgoing page's `@destroy`. While each held its own list of
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
    for (const tag of [...document.head.querySelectorAll(`[${HEAD_ATTR}]`)]) tag.remove();
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
    @Host("div")
    class Home extends Component {
      head = this.use(Head, () => ({ title: "Home", description: "the home page" }));
      render() {
        return <p>home</p>;
      }
    }

    @Host("div")
    class About extends Component {
      head = this.use(Head, () => ({ title: "About", description: "who we are" }));
      render() {
        return <p>about</p>;
      }
    }

    @Host("div")
    class App extends Component {
      @state route = "home";
      render() {
        return this.route === "home" ? <Home /> : <About />;
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
    @Host("div")
    class Home extends Component {
      head = this.use(Head, () => ({
        title: "Home",
        link: [{ rel: "icon", href: "/favicon.ico" }],
      }));
      render() {
        return <p>home</p>;
      }
    }

    @Host("div")
    class About extends Component {
      head = this.use(Head, () => ({
        title: "About",
        link: [{ rel: "icon", href: "/favicon.ico" }],
      }));
      render() {
        return <p>about</p>;
      }
    }

    @Host("div")
    class App extends Component {
      @state route = "home";
      render() {
        return this.route === "home" ? <Home /> : <About />;
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
    @Host("div")
    class Deep extends Component {
      head = this.use(Head, () => ({ description: "the deep page" }));
      render() {
        return <p>deep</p>;
      }
    }

    // Three components with no Head at all between the layout and the page.
    @Host("div")
    class Guard extends Component {
      render() {
        return <Shell />;
      }
    }
    @Host("div")
    class Shell extends Component {
      render() {
        return <Frame />;
      }
    }
    @Host("div")
    class Frame extends Component {
      render() {
        return <Deep />;
      }
    }

    @Host("div")
    class Layout extends Component {
      head = this.use(Head, () => ({ title: "Layout", description: "the layout" }));
      render() {
        return <Guard />;
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
     * Every `Head` publishes during its own `@create`, and the head the document
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

    @Host("div")
    class Page extends Component {
      head = this.use(Head, () => ({ title: "Page" }));
      render() {
        return <p>page</p>;
      }
    }
    @Host("div")
    class Section extends Component {
      head = this.use(Head, () => ({ title: "Section" }));
      render() {
        return <Page />;
      }
    }
    @Host("div")
    class Layout extends Component {
      head = this.use(Head, () => ({ title: "Layout" }));
      render() {
        return <Section />;
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
    @Host("div")
    class Page extends Component {
      head = this.use(Head, () => ({
        description: "the page",
        meta: [{ property: "og:title", content: "page og" }],
      }));
      render() {
        return <p>page</p>;
      }
    }

    @Host("div")
    class Section extends Component {
      head = this.use(Head, () => ({
        meta: [
          { property: "og:title", content: "section og" },
          { name: "robots", content: "noindex" },
        ],
      }));
      render() {
        return <Page />;
      }
    }

    @Host("div")
    class Layout extends Component {
      head = this.use(Head, () => ({
        title: "Site",
        description: "the site",
        meta: [{ name: "viewport", content: "width=device-width" }],
      }));
      render() {
        return <Section />;
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
    @Host("div")
    class Page extends Component {
      @state loud = true;
      head = this.use(Head, () =>
        this.loud
          ? { title: "Page", meta: [{ property: "og:title", content: "page og" }] }
          : { description: "still here" },
      );
      render() {
        return <p>page</p>;
      }
    }

    @Host("div")
    class Layout extends Component {
      head = this.use(Head, () => ({
        title: "Site",
        description: "the site",
        meta: [{ property: "og:title", content: "site og" }],
      }));
      render() {
        return <Page />;
      }
    }

    const app = await getDOM(<Layout />);
    await app.settle();

    const page = app.container.querySelectorAll("div")[1] as { _componentInstance?: { loud: boolean } };
    expect(document.title).toBe("Page");
    expect(document.head.querySelector('meta[property="og:title"]')!.getAttribute("content")).toBe("page og");

    // The page stops setting both, and starts setting a description.
    page._componentInstance!.loud = false;
    await app.settle();

    // Handed back to the layout, not deleted.
    expect(document.title).toBe("Site");
    expect(document.head.querySelector('meta[property="og:title"]')!.getAttribute("content")).toBe("site og");
    // And the page's own new tag won, without disturbing the layout's viewport.
    expect(document.head.querySelector('meta[name="description"]')!.getAttribute("content")).toBe("still here");
  });

  test("what the last page owned still goes when nothing replaces it", async () => {
    @Host("div")
    class Page extends Component {
      head = this.use(Head, () => ({ title: "Page", description: "only page" }));
      render() {
        return <p>page</p>;
      }
    }

    @Host("div")
    class App extends Component {
      @state show = true;
      render() {
        return this.show ? <Page /> : <i>gone</i>;
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
});
