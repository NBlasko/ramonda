import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { getDOM, findOne } from "../test/setup";
import { Component, list, state, createContext } from "../index";
import { HOOK_RUNTIME } from "../core/runtime";

/**
 * A list item's mapper subscribes to whatever it reads — and that is often a
 * signal owned by an ANCESTOR, which outlives the component doing the reading.
 * A context value is the clearest case: the signals live on the provider hook,
 * up the tree.
 *
 * Counting listeners on that provider signal is the only way to see this. The
 * screen is correct either way; a leak shows up as a page that never lets go of
 * subtrees it removed.
 */

const [ThemeProvider, ThemeConsumer] = createContext({ theme: "light" });

interface Row {
  t: string;
}

class Consumer extends Component {
  ctx = this.use(ThemeConsumer);
  @state rows: Row[] = [{ t: "a" }, { t: "b" }, { t: "c" }];
  render() {
    return (
      <div>
        <ul>
          {list(this.rows, (row: Row) => (
            <li>
              {row.t}-{this.ctx.theme}
            </li>
          ))}
        </ul>
      </div>
    );
  }
}

class App extends Component {
  @state theme = "light";
  @state show = true;
  provider = this.use(ThemeProvider, () => ({ theme: this.theme }));
  render() {
    return (
      <div>
        <div>{this.show ? <Consumer /> : null}</div>
      </div>
    );
  }
}

const listenerCount = (signal: unknown) => {
  const s = signal as { _listeners?: Map<unknown, unknown>; _listener?: unknown };
  if (s?._listeners) return s._listeners.size;
  return s?._listener !== undefined ? 1 : 0;
};

describe("list scope cleanup", () => {
  beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  test("items release their subscriptions when they leave, and when the list dies", async () => {
    const app = await getDOM<App>(<App />);
    await app.settle();

    const provider = (app.instance as unknown as { provider: unknown }).provider as Record<
      symbol,
      { propsSignals: Map<string, unknown> }
    >;
    const signal = provider[HOOK_RUNTIME].propsSignals.get("theme");

    // Three items plus the consuming component itself.
    expect(listenerCount(signal)).toBe(4);

    const consumer = findOne<Consumer>(app.container, "Consumer");

    // Items that leave the list let go — this part already worked.
    consumer.rows = [{ t: "a" }];
    await app.settle();
    expect(listenerCount(signal)).toBe(2);

    // And the list leaving the page lets go of the rest. `For` released these
    // from its own `@destroyed`; a `list()` region has no hook to hang that on, so
    // the region's own teardown has to do it.
    app.instance.show = false;
    await app.settle();
    expect(listenerCount(signal)).toBe(0);
    expect(app.container.textContent).toBe("");
  });
});
