import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { getDOM, findOne } from "../test/setup";
import { Component, Hook, state, created, watchProp } from "../index";
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
 * "State and lifecycle, but no markup of my own" — usually answered elsewhere by a
 * component returning null, or a stateful fragment. Ramonda has two answers, and
 * which one you want depends on whether an inert element is acceptable where it sits.
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

    class Page extends Component {
      @state page = "home";
      render() {
        return (
          <div>
            <div className="page">
              <Analytics page={this.page} />
              <span>content</span>
            </div>
          </div>
        );
      }
    }

    const app = await getDOM<Page>(<Page />);
    await app.settle();

    /**
     * It contributes NOTHING to the DOM, which is the whole of what "without markup" means now.
     *
     * There used to be a `<ramonda-host style="display: contents">` here — an element that took part
     * in no layout but was still a node in the page. A component owns a range, and a render that
     * returns nothing owns an empty one, so there is nothing to find and nothing to assert about.
     * It is a full component all the same, which is what the rest of this test measures.
     */
    expect(app.container.querySelector("ramonda-host")).toBeNull();
    expect(findOne<object>(app.container, "Analytics")).toBeDefined();
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

    class Row extends Component<{ label: string }> {
      render() {
        return (
          <tr>
            <td>{this.props.label}</td>
          </tr>
        );
      }
    }

    class TableApp extends Component {
      rowsHook = this.use(RowsHook, () => ({ prefix: "x" }));
      render() {
        return (
          <div>
            <table>
              <tbody>
                {this.rowsHook.rows.map((r) => (
                  <Row key={r} label={r} />
                ))}
              </tbody>
            </table>
          </div>
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
      // Keyed, so the only thing this fixture reports is the fault it is about.
      return [<span key="a">a</span>, <span key="b">b</span>];
    }

    class App extends Component {
      render() {
        return (
          <div>
            {/* @ts-expect-error a function is not a valid Ramonda tag — that is the point */}
            <div>{<Rows />}</div>
          </div>
        );
      }
    }

    await getDOM(<App />);

    expect(captured.codes).toEqual(["RMD011"]);
    expect(captured.messages[0]).toContain("Rows was used as a JSX tag");
    expect(captured.messages[0]).toContain("use a Hook");
    expect(captured.messages[0]).toContain("{sideBar()}");
  });

  /**
   * The same report when the function has no name to print.
   *
   * `jsxRules.ts` writes it with `||` and always did — this is the one place in the nameless family
   * that was already right — but nothing exercised the empty side, so the branch sat unhit and the
   * wording was a promise with nothing behind it. A function expression handed straight to a tag is
   * genuinely anonymous: a `const` or a `function` declaration would lend it their name.
   *
   * The family, and the two directions it went wrong in elsewhere, is in
   * `__tests__/AComponentWithNoName.test.tsx`.
   */
  test("an ANONYMOUS function used as a JSX tag is still given a subject", async () => {
    // Built behind a CALL so nothing lends it a name: `const Rows = () => …` would name it `Rows`,
    // because a function expression written directly as an initializer takes the variable's name.
    // Capitalised because a lowercase JSX tag is an intrinsic element name, not this binding.
    const Anonymous = ((): (() => unknown) => () => [<span key="a">a</span>])();
    expect(Anonymous.name).toBe("");

    class App extends Component {
      render() {
        return (
          <div>
            {/* @ts-expect-error a function is not a valid Ramonda tag — that is the point */}
            <div>{<Anonymous />}</div>
          </div>
        );
      }
    }

    await getDOM(<App />);

    expect(captured.codes).toEqual(["RMD011"]);
    expect(captured.messages[0]).toContain("An anonymous function was used as a JSX tag");
    // The tag in the same sentence has its own fallback, and an empty one would read `<  />`.
    expect(captured.messages[0]).toContain("<… />");
  });
});
