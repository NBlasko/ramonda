import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { getDOM } from "../test/setup";
import { Component } from "../base/Component";
import { Hook } from "../base/Hook";
import { Host, requiresContext } from "../base/decorators";
import { createContext } from "../base/Context";
import { resetDiagnostics } from "../debug/diagnostics";

/**
 * `@requiresContext` moves the report from READ time to MOUNT time.
 *
 * The default is deliberately quiet: holding a consumer you only read down one branch is not a
 * mistake, so RMD003 waits for the read. That leaves a gap — a branch that renders but never
 * reads, or reads only later, says nothing. Declaring the requirement closes it: appearing at all
 * is enough to be checked.
 */

const [ThemeProvider, ThemeConsumer] = createContext({ theme: "light" }, { label: "Theme" });

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
  return { codes, messages, stop: () => window.removeEventListener("ramonda:dev-log", handler) };
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

describe("reports at mount, without anything reading the context", () => {
  test("a declaring component with no provider above it", async () => {
    @requiresContext(ThemeConsumer)
    @Host("div")
    class Panel extends Component {
      // Deliberately does NOT hold or read a consumer: the declaration is the whole check.
      render() {
        return <p>panel</p>;
      }
    }

    await getDOM(<Panel />);
    expect(cap.codes).toContain("RMD003");
    expect(cap.messages.join("\n")).toContain('declares it needs the "Theme" context');
  });

  test("silent when a provider IS above it", async () => {
    @requiresContext(ThemeConsumer)
    @Host("div")
    class Panel extends Component {
      render() {
        return <p>panel</p>;
      }
    }

    @Host("div")
    class App extends Component {
      p = this.use(ThemeProvider, () => ({ theme: "dark" }));
      render() {
        return <Panel />;
      }
    }

    await getDOM(<App />);
    expect(cap.codes).not.toContain("RMD003");
  });

  test("a hook can declare it too", async () => {
    @requiresContext(ThemeConsumer)
    class NeedsTheme extends Hook {}

    @Host("div")
    class App extends Component {
      h = this.use(NeedsTheme);
      render() {
        return <p>x</p>;
      }
    }

    await getDOM(<App />);
    expect(cap.codes).toContain("RMD003");
  });
});

describe("the declaration behaves like the rest of the class chain", () => {
  test("a subclass adds to what its parent declared", async () => {
    const [OtherProvider, OtherConsumer] = createContext({ x: 1 }, { label: "Other" });

    @requiresContext(ThemeConsumer)
    @Host("div")
    class Base extends Component {
      render() {
        return <p>base</p>;
      }
    }

    @requiresContext(OtherConsumer)
    @Host("div")
    class Child extends Base {}

    // Theme is provided; Other is not — so exactly one report, about Other.
    @Host("div")
    class App extends Component {
      p = this.use(ThemeProvider, () => ({ theme: "dark" }));
      render() {
        return <Child />;
      }
    }

    await getDOM(<App />);
    expect(cap.messages.join("\n")).toContain('"Other" context');
    expect(cap.messages.join("\n")).not.toContain('"Theme" context');
    void OtherProvider;
  });
});

describe("misuse", () => {
  test("passing something that is not a context half throws", () => {
    expect(() => {
      @requiresContext({} as never)
      class Bad extends Component {
        render() {
          return null;
        }
      }
      void Bad;
    }).toThrow(/createContext\(\) pair/);
  });
});
