import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { getDOM } from "../test/setup";
import { Component, Host, Hook, state, created, watchProp } from "../index";
import { renderToString } from "../hydration/ssr";
import { resetDiagnostics } from "../debug/diagnostics";

function captureDiagnostics() {
  const codes: string[] = [];
  const messages: string[] = [];
  const handler = (event: Event) => {
    const detail = (event as CustomEvent).detail as { message: string };
    const code = detail.message.match(/^\[(RMD\d+)\]/)?.[1];
    if (!code) return;
    codes.push(code);
    messages.push(detail.message);
  };
  window.addEventListener("ramonda:dev-log", handler);
  return {
    codes,
    messages,
    stop: () => window.removeEventListener("ramonda:dev-log", handler),
  };
}

/**
 * "State and lifecycle, but no markup of my own" — React reaches for a component
 * returning null, or a stateful fragment. Ramonda has two answers, and which one
 * you want depends on whether an inert element is acceptable where it sits.
 */
describe("state and lifecycle without markup", () => {
  let captured: ReturnType<typeof captureDiagnostics>;

  beforeEach(() => {
    resetDiagnostics();
    vi.spyOn(console, "log").mockImplementation(() => {});
    captured = captureDiagnostics();
  });

  afterEach(() => {
    captured.stop();
    vi.restoreAllMocks();
  });

  test("a component may render nothing and still be a full component", async () => {
    // The everyday answer. The default host is display:contents, so the element
    // exists but takes part in no layout — the wrapper is not a cost.
    let createdCount = 0;
    let tracked = 0;

    class Analytics extends Component<{ page: string }> {
      @created init() {
        createdCount++;
      }

      @watchProp((props) => props.page)
      track() {
        tracked++;
      }

      render() {
        return null;
      }
    }

    @Host("div")
    class Page extends Component {
      @state page = "home";
      render() {
        return (
          <div className="page">
            <Analytics page={this.page} />
            <span>content</span>
          </div>
        );
      }
    }

    const app = await getDOM<Page>(<Page />);
    await app.settle();

    const host = app.container.querySelector("ramonda-host")!;
    expect(host.childNodes.length).toBe(0);
    expect(host.getAttribute("style")).toBe("display: contents;");
    expect(createdCount).toBe(1);
    // `@watchProp` does not fire on mount — `@created` is the initial pass — so nothing
    // has been tracked yet.
    expect(tracked).toBe(0);

    // It keeps its own reactivity: a prop change reaches it, element or no element.
    app.instance.page = "about";
    await app.settle();
    expect(tracked).toBe(1);

    expect(captured.codes).toEqual([]);
  });

  test("a Hook carries state and lifecycle where no element is allowed at all", async () => {
    // Inside <tbody> even an inert element is destroyed by the parser (RMD010),
    // so this is where "component with no element" genuinely has no answer — and
    // where a Hook is the answer instead.
    class RowsHook extends Hook<{ prefix: string }> {
      @state rows: string[] = [];

      @created load() {
        this.rows = ["a", "b"];
      }

      add(next: string) {
        this.rows = [...this.rows, next];
      }
    }

    @Host("tr")
    class Row extends Component<{ label: string }> {
      render() {
        return <td>{this.props.label}</td>;
      }
    }

    @Host("div")
    class TableApp extends Component {
      rowsHook = this.use(RowsHook, { prefix: "x" });
      render() {
        return (
          <table>
            <tbody>
              {this.rowsHook.rows.map((r) => (
                <Row key={r} label={r} />
              ))}
            </tbody>
          </table>
        );
      }
    }

    const app = await getDOM<TableApp>(<TableApp />);
    await app.settle();

    // @created on the hook ran, and its state drove the render.
    expect(app.container.querySelectorAll("tbody > tr").length).toBe(2);

    // A write to hook state re-renders the owner.
    app.instance.rowsHook.add("c");
    await app.settle();
    expect(app.container.querySelectorAll("tbody > tr").length).toBe(3);

    // And it contributed no node of its own — nothing for the parser to destroy.
    expect(app.container.querySelector("ramonda-host")).toBeNull();
    expect(captured.codes).toEqual([]);

    const html = await renderToString(<TableApp />);
    const back = document.createElement("div");
    back.innerHTML = html;
    expect(back.innerHTML).toBe(html);
  });

  test("a function used as a JSX tag is reported (RMD011)", async () => {
    // TypeScript rejects this at the call site; the runtime check is here so the
    // rule holds even when types are bypassed, and so the message can point at
    // the two patterns above instead of leaving a tag that is not an element.
    function Rows() {
      return [<span>a</span>, <span>b</span>];
    }

    @Host("div")
    class App extends Component {
      render() {
        // @ts-expect-error a function is not a valid Ramonda tag — that is the point
        return <div>{<Rows />}</div>;
      }
    }

    await getDOM(<App />);

    expect(captured.codes).toEqual(["RMD011"]);
    expect(captured.messages[0]).toContain("Rows was used as a JSX tag");
    expect(captured.messages[0]).toContain("use a Hook");
    expect(captured.messages[0]).toContain("{rows()}");
  });
});
