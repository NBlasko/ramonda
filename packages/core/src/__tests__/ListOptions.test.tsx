import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { getDOM } from "../test/setup";
import { Component, Host, list, state } from "../index";
import { resetDiagnostics } from "../debug/diagnostics";

/**
 * TypeScript already rejects both `as` and `render` together, and rejects
 * neither. JavaScript apps have no types, and both mistakes fail QUIETLY — with
 * both given `as` wins and the render callback is simply never called.
 */

interface Row {
  t: string;
}

@Host("li")
class RowView extends Component<{ item: Row }> {
  render() {
    return <span>as:{this.props.item.t}</span>;
  }
}

describe("list(): as XOR render", () => {
  const codes: string[] = [];
  const messages: string[] = [];
  const handler = (event: Event) => {
    const message = (event as CustomEvent).detail?.message as string;
    const code = message?.match(/^\[(RMD\d+)\]/)?.[1];
    if (code) {
      codes.push(code);
      messages.push(message);
    }
  };

  beforeEach(() => {
    codes.length = 0;
    messages.length = 0;
    resetDiagnostics();
    window.addEventListener("ramonda:dev-log", handler);
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    window.removeEventListener("ramonda:dev-log", handler);
    vi.restoreAllMocks();
  });

  test("both given is reported, and says which one wins", async () => {
    @Host("div")
    class App extends Component {
      @state rows: Row[] = [{ t: "a" }];
      render() {
        return (
          <ul>
            {list({
              each: this.rows,
              as: RowView,
              render: (row: Row) => <li>render:{row.t}</li>,
              // Only reachable from JavaScript; the cast is what a JS caller
              // gets for free.
            } as never)}
          </ul>
        );
      }
    }

    const app = await getDOM<App>(<App />);
    await app.settle();

    expect(codes).toContain("RMD014");
    expect(messages.join("\n")).toContain("`as` is used");
    // And the message is true: `as` really is what rendered.
    expect(app.container.textContent).toContain("as:a");
  });

  test("neither given is reported", async () => {
    @Host("div")
    class App extends Component {
      @state rows: Row[] = [{ t: "a" }];
      render() {
        return <ul>{list({ each: this.rows } as never)}</ul>;
      }
    }

    const app = await getDOM<App>(<App />);
    await app.settle();

    expect(codes).toContain("RMD014");
    expect(messages.join("\n")).toContain("Neither");
  });

  test("a correct list reports nothing", async () => {
    @Host("div")
    class App extends Component {
      @state rows: Row[] = [{ t: "a" }, { t: "b" }];
      render() {
        return <ul>{list({ each: this.rows, as: RowView })}</ul>;
      }
    }

    const app = await getDOM<App>(<App />);
    await app.settle();

    expect(app.container.querySelectorAll("li").length).toBe(2);
    expect(codes).toEqual([]);
  });
});
