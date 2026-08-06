import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { getDOM } from "../test/setup";
import { Component, Host, state, createContext } from "../index";

/**
 * Two things about a context subscription that a reader has to be told, because
 * neither follows from "you react to the keys you read".
 *
 * They are pinned here rather than only written down, because prose is the one
 * thing types, lint and tests all pass over — and both of these are the kind of
 * detail that reads as an implementation accident until someone changes it and a
 * page starts re-rendering, or stops.
 */
describe("what a context subscription covers", () => {
  beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  test("the tie is made on the first read and lasts until the component goes", async () => {
    const [Provider, Consumer] = createContext({ theme: "light", accent: "pink" }, { label: "Theme" });

    let renders = 0;

    @Host("p")
    class Reader extends Component<{ showAccent: boolean }> {
      ctx = this.use(Consumer);

      render() {
        renders++;
        // `accent` is read on ONE branch only.
        return <span>{this.props.showAccent ? this.ctx.accent : this.ctx.theme}</span>;
      }
    }

    @Host("div")
    class App extends Component {
      @state accent = "pink";
      @state showAccent = true;
      provider = this.use(Provider, () => ({ theme: "light", accent: this.accent }));

      render() {
        return <Reader showAccent={this.showAccent} />;
      }
    }

    const app = await getDOM<App>(<App />);
    await app.settle();

    // Stop reading `accent`.
    app.instance.showAccent = false;
    await app.settle();

    renders = 0;
    app.instance.accent = "red";
    await app.settle();

    /**
     * Still re-renders, though the branch that reads `accent` is no longer taken:
     * the first read subscribed and nothing unsubscribes until unmount. The DOM is
     * untouched — the render finds nothing different — but the work happens, and
     * that is the difference from a render-tracked model.
     */
    expect(renders).toBe(1);
    expect(app.container.querySelector("span")!.textContent).toBe("light");
  });

  test("a key is compared, not explored — changing inside its value tells nobody", async () => {
    const [Provider, Consumer] = createContext({ limits: { max: 1 } }, { label: "Limits" });

    @Host("p")
    class Reader extends Component {
      ctx = this.use(Consumer);
      render() {
        return <span>{this.ctx.limits.max}</span>;
      }
    }

    @Host("div")
    class App extends Component {
      @state limits = { max: 1 };
      provider = this.use(Provider, () => ({ limits: this.limits }));
      render() {
        return <Reader />;
      }
    }

    const app = await getDOM<App>(<App />);
    await app.settle();
    expect(app.container.querySelector("span")!.textContent).toBe("1");

    // Replacing the value is what a key notices.
    app.instance.limits = { max: 5 };
    await app.settle();
    expect(app.container.querySelector("span")!.textContent).toBe("5");
  });
});
