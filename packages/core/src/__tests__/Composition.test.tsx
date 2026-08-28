import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { getDOM } from "../test/setup";
import { Component, Hook, state, created } from "../index";
import type { RamondaNode } from "../index";
import { renderToString } from "../hydration/ssr";
import { resetDiagnostics } from "../debug/diagnostics";

function captureDiagnostics() {
  const codes: string[] = [];
  const handler = (event: Event) => {
    const detail = (event as CustomEvent).detail as { message: string };
    const code = detail.message.match(/^\[(RMD\d+)\]/)?.[1];
    if (code) codes.push(code);
  };
  window.addEventListener("ramonda:dev-log", handler);
  return {
    codes,
    stop: () => window.removeEventListener("ramonda:dev-log", handler),
  };
}

/**
 * Composition where a wrapper element is illegal.
 *
 * Where the unit of reuse is a function, reuse means NESTING — functions cannot
 * extend one another — and nesting costs an element unless a fragment hides it.
 * Ramonda's units of reuse are the class and the Hook, neither of which nests, so
 * the wrapper never appears and there is nothing for a fragment to hide.
 */
describe("composition inside a <tr>, where only <td> is legal", () => {
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

  test("a reusable cell IS the <td>, and takes children", async () => {
    // Not a wrapper around a td — the td itself. Composition happens through
    // props and children, inside the element the parent already expects.
    class StyledCell extends Component<{ tone?: string; children?: RamondaNode }> {
      render() {
        return (
          <td>
            <span className={this.props.tone ?? "plain"}>{this.props.children}</span>
          </td>
        );
      }
    }

    class App extends Component {
      render() {
        return (
          <div>
            <table>
              <tbody>
                <tr>
                  <StyledCell tone="hot">a</StyledCell>
                  <td>b</td>
                </tr>
              </tbody>
            </table>
          </div>
        );
      }
    }

    const html = await renderToString(<App />);
    const back = document.createElement("div");
    back.innerHTML = html;

    expect(back.innerHTML).toBe(html);
    expect(back.querySelectorAll("tr > td").length).toBe(2);
    expect(back.querySelector("td span")!.className).toBe("hot");
    expect(captured.codes).toEqual([]);
  });

  test("the tag is inherited with the render, so behaviour composes by extending", async () => {
    // "Someone styled a <td> and we want to add to it, but it must stay a <td>."
    // The tag is written in render(), so a subclass inherits it by inheriting the render and
    // changes it by writing its own — and it is still exactly one <td>, with no wrapper to hide.
    class BaseCell extends Component<{ label?: string }> {
      protected decorate(v: string) {
        return v.toUpperCase();
      }
      render() {
        return (
          <td>
            <span>{this.decorate(this.props.label ?? "")}</span>
          </td>
        );
      }
    }

    class FancyCell extends BaseCell {
      protected override decorate(v: string) {
        return `«${super.decorate(v)}»`;
      }
    }

    class App extends Component {
      render() {
        return (
          <div>
            <table>
              <tbody>
                <tr>
                  <BaseCell label="a" />
                  <FancyCell label="b" />
                </tr>
              </tbody>
            </table>
          </div>
        );
      }
    }

    const app = await getDOM(<App />);
    await app.settle();

    const cells = app.container.querySelectorAll("tr > td");
    expect(cells.length).toBe(2);
    expect(cells[0].textContent).toBe("A");
    expect(cells[1].textContent).toBe("«B»");
    // The subclass did not add a second element.
    expect(app.container.querySelector("td td")).toBeNull();
    expect(captured.codes).toEqual([]);
  });

  test("a group of cells with shared state is a Hook, not a component", async () => {
    // The actual fragment case: 3 of the 10 cells share state and want to be one
    // reusable unit. A component there would have to be an element, and only
    // <td> is legal — so the unit is a Hook, and its cells are spliced in.
    class StyledCell extends Component<{ tone: string; children?: RamondaNode }> {
      render() {
        return (
          <td>
            <span className={this.props.tone}>{this.props.children}</span>
          </td>
        );
      }
    }

    class FirstThree extends Hook<{ labels: string[] }> {
      @state active = 0;

      @created init() {
        this.active = 1;
      }

      select(i: number) {
        this.active = i;
      }

      cells() {
        return this.props.labels.map((l, i) => (
          <StyledCell key={l} tone={i === this.active ? "hot" : "cool"}>
            {l}
          </StyledCell>
        ));
      }
    }

    class App extends Component {
      group = this.use(FirstThree, () => ({ labels: ["a", "b", "c"] }));
      render() {
        return (
          <div>
            <table>
              <tbody>
                <tr>
                  {this.group.cells()}
                  <td>4</td>
                </tr>
              </tbody>
            </table>
          </div>
        );
      }
    }

    const app = await getDOM<App>(<App />);
    await app.settle();

    // Three cells from the hook plus the literal one: all direct <td> of the
    // <tr>, with nothing wrapping them.
    expect(app.container.querySelectorAll("tr > td").length).toBe(4);
    expect(app.container.querySelector("ramonda-host")).toBeNull();
    // The hook's @created ran and its state drove which cell is hot.
    expect(app.container.querySelectorAll("span.hot").length).toBe(1);
    expect(app.container.querySelectorAll("span.hot")[0].textContent).toBe("b");

    // Its state writes re-render the owner — the hook has no boundary of its own.
    app.instance.group.select(2);
    await app.settle();
    expect(app.container.querySelectorAll("span.hot")[0].textContent).toBe("c");

    expect(captured.codes).toEqual([]);

    const html = await renderToString(<App />);
    const back = document.createElement("div");
    back.innerHTML = html;
    expect(back.innerHTML).toBe(html);
  });
});
