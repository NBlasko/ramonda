import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { getDOM } from "../../test/setup";
import { Component } from "../../base/Component";
import { state } from "../../base/decorators";
import { createContext } from "../../base/Context";
import { Head, resetHeadRegistry } from "../../base/Head";
import { hydrateRoot } from "../../hydration/hydrate";
import { renderToString } from "../../hydration/ssr";
import { PORTAL_ATTR } from "../../helpers/constants";

/**
 * The one object `createContext` and `Head` both publish on — see the `Context` type.
 *
 * Two properties carry everything either of them does: a component's object is created FROM its
 * parent's, so a read walks up to the nearest ancestor that published; and a publish lands as an
 * OWN property, so a sibling reading the same ancestor never sees it. Two publishers, four
 * creation sites, and one line in `createComponent` that decides it for all of them.
 *
 * Measured before this file existed: replacing that line with the parent's object — the change
 * anyone would make to save an allocation — failed **2 of core's 1116 tests, both about `Head`**.
 * The context half of the same mechanism was unguarded, so a `createContext` Provider becoming
 * visible to its siblings was a silent change. The tests below are that gate, and they are in one
 * file with the `Head` ones beside them because the thing being protected is shared.
 *
 * HYDRATION creates the objects in a second place, and the last test is here rather than beside the
 * other hydration tests for the same reason: it is the same invariant, and a reader who changes one
 * creator has to find the other. Breaking that one alone was silent across all 1121 tests.
 */
describe("a context object is one per component", () => {
  beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));
  afterEach(() => {
    vi.restoreAllMocks();
    resetHeadRegistry();
    for (const tag of [...document.head.querySelectorAll(`[${PORTAL_ATTR}]`)]) tag.remove();
    document.title = "";
  });

  test("a sibling does not see what its sibling provided", async () => {
    const [Provider, Consumer] = createContext({ label: "default" }, { optional: true });

    /** Provides, and is the only branch entitled to the value. */
    class Provides extends Component {
      ctx = this.use(Provider, () => ({ label: "provided" }));
      render() {
        return (
          <div>
            <p id="inside">{this.ctx.label}</p>
          </div>
        );
      }
    }

    /**
     * Beside it, not under it. It reads the same ancestor object, so it must reach the DEFAULT —
     * this is the assertion that a publish is an own property rather than a write up the chain.
     */
    class Beside extends Component {
      ctx = this.use(Consumer);
      render() {
        return (
          <div>
            <p id="beside">{this.ctx.label}</p>
          </div>
        );
      }
    }

    class App extends Component {
      render() {
        return (
          <div>
            <div>
              <Provides />
              <Beside />
            </div>
          </div>
        );
      }
    }

    using app = await getDOM<App>(<App />);
    await app.settle();

    expect(document.getElementById("inside")?.textContent).toBe("provided");
    expect(document.getElementById("beside")?.textContent).toBe("default");
  });

  test("a descendant sees it however many components apart, because none of them published", async () => {
    const [Provider, Consumer] = createContext({ label: "default" }, { optional: true });

    class Deep extends Component {
      ctx = this.use(Consumer);
      render() {
        return (
          <div>
            <p id="deep">{this.ctx.label}</p>
          </div>
        );
      }
    }

    /** Publishes nothing, so it is invisible to the lookup — the whole point of the chain. */
    class Wrapper extends Component {
      render() {
        return (
          <div>
            <div>
              <Deep />
            </div>
          </div>
        );
      }
    }

    class Guard extends Component {
      render() {
        return (
          <div>
            <div>
              <Wrapper />
            </div>
          </div>
        );
      }
    }

    class App extends Component {
      ctx = this.use(Provider, () => ({ label: "from the top" }));
      render() {
        return (
          <div>
            <div>
              <Guard />
            </div>
          </div>
        );
      }
    }

    using app = await getDOM<App>(<App />);
    await app.settle();

    expect(document.getElementById("deep")?.textContent).toBe("from the top");
  });

  test("the nearer provider wins, and the further one is still there for its own branch", async () => {
    const [Provider, Consumer] = createContext({ label: "default" }, { optional: true });

    class Reader extends Component {
      ctx = this.use(Consumer);
      render() {
        return (
          <div>
            <p class="read">{this.ctx.label}</p>
          </div>
        );
      }
    }

    /** Shadows the one above for its own subtree only. */
    class Inner extends Component {
      ctx = this.use(Provider, () => ({ label: "inner" }));
      render() {
        return (
          <div>
            <div>
              <Reader />
            </div>
          </div>
        );
      }
    }

    class App extends Component {
      ctx = this.use(Provider, () => ({ label: "outer" }));
      render() {
        return (
          <div>
            <div>
              <Inner />
              <Reader />
            </div>
          </div>
        );
      }
    }

    using app = await getDOM<App>(<App />);
    await app.settle();

    const read = [...document.querySelectorAll(".read")].map((node) => node.textContent);
    expect(read).toEqual(["inner", "outer"]);
  });

  test("a provider still reaches a consumer when it changes, across the wrappers between them", async () => {
    const [Provider, Consumer] = createContext({ label: "default" }, { optional: true });

    class Deep extends Component {
      ctx = this.use(Consumer);
      render() {
        return (
          <div>
            <p id="deep">{this.ctx.label}</p>
          </div>
        );
      }
    }

    class Wrapper extends Component {
      render() {
        return (
          <div>
            <div>
              <Deep />
            </div>
          </div>
        );
      }
    }

    class App extends Component {
      @state label = "first";
      ctx = this.use(Provider, () => ({ label: this.label }));
      render() {
        return (
          <div>
            <div>
              <Wrapper />
            </div>
          </div>
        );
      }
    }

    using app = await getDOM<App>(<App />);
    await app.settle();
    expect(document.getElementById("deep")?.textContent).toBe("first");

    app.instance.label = "second";
    await app.settle();
    expect(document.getElementById("deep")?.textContent).toBe("second");
  });

  test("a `Head` and a context share the object and neither is disturbed by the other", async () => {
    const [Provider, Consumer] = createContext({ label: "default" }, { optional: true });

    /**
     * Under the provider AND under its `Head`, publishing a `Head` of its own. So on this one path
     * both keys are published twice and read from both levels — which is what says the two
     * publishers cannot collide: one uses a number from `createId()`, the other a private symbol.
     */
    class Page extends Component {
      ctx = this.use(Consumer);
      head = this.use(Head, () => ({ title: "the page" }));
      render() {
        return (
          <div>
            <p id="page">{this.ctx.label}</p>
          </div>
        );
      }
    }

    /** Beside the page: no provider and no `Head` above it, so it gets the default and no title. */
    class Aside extends Component {
      ctx = this.use(Consumer);
      render() {
        return (
          <div>
            <p id="aside">{this.ctx.label}</p>
          </div>
        );
      }
    }

    class Layout extends Component {
      ctx = this.use(Provider, () => ({ label: "from the layout" }));
      head = this.use(Head, () => ({ title: "the layout", description: "set once, by the layout" }));
      render() {
        return (
          <div>
            <div>
              <Page />
            </div>
          </div>
        );
      }
    }

    class App extends Component {
      render() {
        return (
          <div>
            <div>
              <Layout />
              <Aside />
            </div>
          </div>
        );
      }
    }

    using app = await getDOM<App>(<App />);
    await app.settle();

    // The context: down the chain for the page, the default for the one beside it.
    expect(document.getElementById("page")?.textContent).toBe("from the layout");
    expect(document.getElementById("aside")?.textContent).toBe("default");

    // The head: the deeper `Head` wins the title it also sets, and the layout keeps what only it
    // said — the head is the merge of the tree, which is only a tree because of the same chain.
    expect(document.title).toBe("the page");
    expect(document.head.querySelector('meta[name="description"]')?.getAttribute("content")).toBe(
      "set once, by the layout",
    );
  });
  test("hydration creates its own objects too, so a hydrated sibling gets the default", async () => {
    const [Provider, Consumer] = createContext({ label: "default" }, { optional: true });

    class Page extends Component {
      ctx = this.use(Consumer);
      render() {
        return (
          <div>
            <p id="page">{this.ctx.label}</p>
          </div>
        );
      }
    }

    class Layout extends Component {
      ctx = this.use(Provider, () => ({ label: "from the layout" }));
      render() {
        return (
          <div>
            <div>
              <Page />
            </div>
          </div>
        );
      }
    }

    /** Beside the layout, and constructed AFTER it — so a shared object would already hold the
     * channel by the time this one looks. That ordering is what makes the assertion meaningful. */
    class Aside extends Component {
      ctx = this.use(Consumer);
      render() {
        return (
          <div>
            <p id="aside">{this.ctx.label}</p>
          </div>
        );
      }
    }

    class App extends Component {
      render() {
        return (
          <div>
            <div>
              <Layout />
              <Aside />
            </div>
          </div>
        );
      }
    }

    const html = await renderToString(<App />);
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = html;

    // The server got it right on its own — this is the control, and it goes through the other
    // creator, so a green line here says the two are being compared rather than one being read twice.
    expect(container.querySelector("#page")?.textContent).toBe("from the layout");
    expect(container.querySelector("#aside")?.textContent).toBe("default");

    hydrateRoot(<App />, container);
    await Promise.resolve();

    expect(container.querySelector("#page")?.textContent).toBe("from the layout");
    expect(container.querySelector("#aside")?.textContent).toBe("default");
    container.remove();
  });
});
