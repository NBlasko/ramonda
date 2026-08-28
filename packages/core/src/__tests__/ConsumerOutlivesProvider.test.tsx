import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { getDOM } from "../test/setup";
import { state } from "../base/decorators";
import { Component } from "../base/Component";
import { createContext } from "../base/Context";
import { resetDiagnostics } from "../debug/diagnostics";

let records: RamondaDiagnostic[] = [];
beforeEach(() => {
  records = [];
  resetDiagnostics();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  globalThis.__RAMONDA_DIAGNOSTICS__ = (r) => records.push(r);
});
afterEach(() => {
  globalThis.__RAMONDA_DIAGNOSTICS__ = undefined;
  vi.restoreAllMocks();
});

const [ThemeProvider, ThemeConsumer] = createContext({ colour: "default" }, { label: "theme" });

/**
 * A consumer that outlives the provider above it.
 *
 * Checked during the review because it is the sharpest thing a context can get wrong: the provider
 * is removed by an ordinary state change while the consumer stays mounted, so a stale read here
 * would be a value from a component that no longer exists — correct-looking, and wrong forever.
 *
 * It does the right thing on both halves, which is why both are asserted: the read falls back to
 * the DEFAULT the context was created with, and `RMD003` reports that there is no provider. Either
 * alone would be a worse outcome — a silent fallback hides the mistake, and a report with a stale
 * value hides it differently.
 */
describe("a consumer outliving its provider", () => {
  test("falls back to the default, and says so", async () => {
    class Leaf extends Component {
      ctx = this.use(ThemeConsumer);
      render() {
        return (
          <div>
            <span className="leaf">{(this.ctx as { colour: string }).colour}</span>
          </div>
        );
      }
    }

    class Provider extends Component {
      p = this.use(ThemeProvider, () => ({ colour: "dark" }));
      render() {
        return (
          <div>
            <Leaf />
          </div>
        );
      }
    }

    class App extends Component {
      @state withProvider = true;
      render() {
        // The leaf stays; the provider around it goes away.
        return (
          <div>
            <div>{this.withProvider ? <Provider /> : <Leaf />}</div>
          </div>
        );
      }
    }

    const dom = await getDOM<App>(<App />);
    await dom.settle();

    // While the provider is there: its value, and nothing to report.
    expect(dom.container.textContent).toBe("dark");
    expect(records.map((record) => record.code)).toEqual([]);

    records = [];
    dom.instance.withProvider = false;
    await dom.settle();

    // Once it is gone: the default the context was created with, not the provider's last value.
    expect(dom.container.textContent).toBe("default");
    expect(records.map((record) => record.code)).toContain("RMD003");
    dom.unmount();
  });
});
