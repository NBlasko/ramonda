import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { getDOM } from "../test/setup";
import { Component } from "../base/Component";
import { Hook } from "../base/Hook";
import { createContext } from "../base/Context";
import { resetDiagnostics } from "../debug/diagnostics";

/**
 * A missing provider is reported when the consumer is CONSTRUCTED — which is when its owner
 * mounts — and not when a value is first read.
 *
 * Nothing is declared to make that work: `this.use(ThemeConsumer)` already names the context,
 * and the consumer looks its channel up once, at construction. So the answer exists at mount;
 * waiting for a read only postponed it, and for a value read down a branch nobody clicks,
 * postponed it forever.
 */

function capture() {
  const codes: string[] = [];
  const messages: string[] = [];
  const handler = (e: Event) => {
    const detail = (e as CustomEvent).detail as { message?: string };
    const code = detail?.message?.match(/^\[(RMD\d+)\]/);
    if (code) {
      codes.push(code[1]);
      messages.push(detail.message ?? "");
    }
  };
  window.addEventListener("ramonda:dev-log", handler);
  return {
    codes,
    messages,
    stop: () => window.removeEventListener("ramonda:dev-log", handler),
  };
}

let cap: ReturnType<typeof capture>;
beforeEach(() => {
  resetDiagnostics();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  cap = capture();
});
afterEach(() => {
  cap.stop();
  vi.restoreAllMocks();
});

describe("reported at mount", () => {
  test("a consumer that is held and never read still reports", async () => {
    const [, ThemeConsumer] = createContext({ theme: "light" }, { label: "Theme" });

    class Panel extends Component {
      // Held, never read. This is the case the read-time report could not see, and it is the
      // reason the check moved: the page renders, the default fills in, nothing looks wrong.
      ctx = this.use(ThemeConsumer);
      render() {
        return (
          <div>
            <p>panel</p>
          </div>
        );
      }
    }

    await getDOM(<Panel />);

    expect(cap.codes).toContain("RMD003");
    expect(cap.messages.join("\n")).toContain("<Panel /> mounts ThemeConsumer with no Provider");
  });

  test("the report names the COMPONENT, even when a hook holds the consumer", async () => {
    const [, ThemeConsumer] = createContext({ theme: "light" }, { label: "Theme" });

    class Theming extends Hook {
      private ctx = this.use(ThemeConsumer);
      get theme(): string {
        return this.ctx.theme;
      }
    }

    class Toolbar extends Component {
      private theming = this.use(Theming);
      render() {
        return (
          <div>
            <p>{this.theming.theme}</p>
          </div>
        );
      }
    }

    await getDOM(<Toolbar />);

    // A hook shares its owner's runtime, and the fix is a Provider above the COMPONENT — so
    // that is the name worth printing.
    expect(cap.messages.join("\n")).toContain("<Toolbar /> mounts ThemeConsumer");
  });

  test("silent when a provider is above", async () => {
    const [ThemeProvider, ThemeConsumer] = createContext({ theme: "light" }, { label: "Theme" });

    class Panel extends Component {
      ctx = this.use(ThemeConsumer);
      render() {
        return (
          <div>
            <p>{this.ctx.theme}</p>
          </div>
        );
      }
    }

    class App extends Component {
      p = this.use(ThemeProvider, () => ({ theme: "dark" }));
      render() {
        return (
          <div>
            <Panel />
          </div>
        );
      }
    }

    const app = await getDOM<App>(<App />);
    await app.settle();

    expect(cap.codes).not.toContain("RMD003");
    expect(app.container.textContent).toBe("dark");
  });

  test("once per component, however many instances mount", async () => {
    const [, ThemeConsumer] = createContext({ theme: "light" }, { label: "Theme" });

    class Row extends Component {
      ctx = this.use(ThemeConsumer);
      render() {
        return (
          <div>
            <p>row</p>
          </div>
        );
      }
    }

    class App extends Component {
      render() {
        return (
          <div>
            <div>
              <Row />
              <Row />
              <Row />
            </div>
          </div>
        );
      }
    }

    await getDOM<App>(<App />);

    expect(cap.codes.filter((c) => c === "RMD003")).toHaveLength(1);
  });
});

describe("optional: the default is a real answer", () => {
  test("no report, and the default is what the consumer reads", async () => {
    const [, ParamsConsumer] = createContext({ params: {} }, { label: "Params", optional: true });

    class Nav extends Component {
      ctx = this.use(ParamsConsumer);
      render() {
        return (
          <div>
            <p>{Object.keys(this.ctx.params).length}</p>
          </div>
        );
      }
    }

    const app = await getDOM<Nav>(<Nav />);
    await app.settle();

    expect(cap.codes).not.toContain("RMD003");
    expect(app.container.textContent).toBe("0");
  });

  test("the flag is the context's, not the consumer's — one context stays quiet, the other does not", async () => {
    const [, Loose] = createContext({ a: 1 }, { label: "Loose", optional: true });
    const [, Strict] = createContext({ b: 2 }, { label: "Strict" });

    class Both extends Component {
      loose = this.use(Loose);
      strict = this.use(Strict);
      render() {
        return (
          <div>
            <p>x</p>
          </div>
        );
      }
    }

    await getDOM(<Both />);

    const text = cap.messages.join("\n");
    expect(text).toContain("StrictConsumer");
    expect(text).not.toContain("LooseConsumer");
  });
});

describe("the ordering rule this makes visible", () => {
  test("a provider declared AFTER the consumer in the same class is a real miss", async () => {
    const [ThemeProvider, ThemeConsumer] = createContext({ theme: "light" }, { label: "Theme" });

    class Backwards extends Component {
      // Field initializers run in order, and the consumer resolves its channel once — so this
      // consumer never sees the provider below it and reads the default forever. Reporting at
      // mount does not create that fault, it names it.
      ctx = this.use(ThemeConsumer);
      p = this.use(ThemeProvider, () => ({ theme: "dark" }));
      render() {
        return (
          <div>
            <p>{this.ctx.theme}</p>
          </div>
        );
      }
    }

    const app = await getDOM<Backwards>(<Backwards />);
    await app.settle();

    expect(cap.codes).toContain("RMD003");
    expect(app.container.textContent).toBe("light");
  });
});
