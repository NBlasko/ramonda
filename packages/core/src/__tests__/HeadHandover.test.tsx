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
