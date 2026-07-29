import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { getDOM } from "../test/setup";
import { Component } from "../base/Component";
import { list } from "../base/list";
import { Host, state } from "../base/decorators";
import { resetDiagnostics } from "../debug/diagnostics";
import type { RamondaNode } from "../types/vdom";

/**
 * RMD023 — components built from an array with no keys.
 *
 * The check the double render cannot make. A mapper is handed to `Array.prototype.map`
 * and never stored anywhere a comparison can reach, and its output is a run of freshly
 * built vnodes, which is what all JSX looks like. Structure is the only thing that can
 * see it: JSX passes children as separate arguments, so a nested ARRAY among them was
 * built by an expression.
 *
 * Narrow on purpose, and these tests are the boundary. A mapped array is a SUPPORTED
 * shape here — it becomes a region with its own key space — so the report is only for the
 * part that is genuinely unhandled: identity. Plain markup patched in place is correct;
 * a component whose row moves takes its `@state` and its DOM to the wrong item.
 */

@Host("li")
class Row extends Component<{ label: string }> {
  @state hits = 0;
  render() {
    return <span>{this.props.label}</span>;
  }
}

let logs: string[] = [];

beforeEach(() => {
  resetDiagnostics();
  logs = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function reported(): string {
  return logs.join("\n");
}

describe("RMD023", () => {
  test("unkeyed components from a .map() are reported, with both names", async () => {
    class App extends Component {
      @state items = ["a", "b"];
      render() {
        return (
          <ul>
            {this.items.map((i) => (
              <Row label={i} />
            ))}
          </ul>
        );
      }
    }

    await getDOM<App>(<App />);

    expect(reported()).toContain("RMD023");
    expect(reported()).toContain("<App /> built <Row /> children from an array");
    expect(reported()).toContain("key");
    expect(reported()).toContain("list(");
  });

  test("keys silence it — the app is managing identity", async () => {
    class App extends Component {
      @state items = ["a", "b"];
      render() {
        return (
          <ul>
            {this.items.map((i) => (
              <Row key={i} label={i} />
            ))}
          </ul>
        );
      }
    }

    await getDOM<App>(<App />);
    expect(reported()).not.toContain("RMD023");
  });

  test("plain markup is not reported — the diff patches it and the result is correct", async () => {
    class App extends Component {
      @state items = ["a", "b"];
      render() {
        return (
          <ul>
            {this.items.map((i) => (
              <li>{i}</li>
            ))}
          </ul>
        );
      }
    }

    await getDOM<App>(<App />);
    expect(reported()).not.toContain("RMD023");
  });

  test("list() is not reported — it is the fix", async () => {
    class App extends Component {
      @state items = ["a", "b"];
      renderRow(item: string) {
        return <Row label={item} />;
      }
      render() {
        return <ul>{list({ each: this.items, render: this.renderRow })}</ul>;
      }
    }

    await getDOM<App>(<App />);
    expect(reported()).not.toContain("RMD023");
  });

  test("forwarding {this.props.children} is not reported, however many there are", async () => {
    /**
     * The false positive that decides whether this check can exist. A component's
     * children ARE an array — the framework's own, built by `normalizeChildren` — and
     * passing it down would look exactly like a mapped one without the brand.
     */
    class Card extends Component<{ children?: RamondaNode }> {
      render() {
        return <ul>{this.props.children}</ul>;
      }
    }

    class App extends Component {
      render() {
        return (
          <Card>
            <Row label="a" />
            <Row label="b" />
          </Card>
        );
      }
    }

    await getDOM<App>(<App />);
    expect(reported()).not.toContain("RMD023");
  });

  test("one child is not reported — it has no siblings to be reordered against", async () => {
    class App extends Component {
      @state items = ["only"];
      render() {
        return (
          <ul>
            {this.items.map((i) => (
              <Row label={i} />
            ))}
          </ul>
        );
      }
    }

    await getDOM<App>(<App />);
    expect(reported()).not.toContain("RMD023");
  });

  test("the damage it describes is real: removing the first row moves the state", async () => {
    class App extends Component {
      @state items = ["a", "b", "c"];
      render() {
        return (
          <ul>
            {this.items.map((i) => (
              <Row label={i} />
            ))}
          </ul>
        );
      }
    }

    const app = await getDOM<App>(<App />);
    await app.settle();

    // Mark the SECOND row, which is "b".
    const rows = () => Array.from(app.container.querySelectorAll("li"));
    const second = rows()[1] as Element & { _componentInstance?: Row };
    second._componentInstance!.hits = 99;

    app.instance.items = ["b", "c"];
    await app.settle();

    // "b" is now first, and the marked instance stayed at position 1 — which is "c".
    const marked = rows().findIndex(
      (li) => (li as Element & { _componentInstance?: Row })._componentInstance?.hits === 99,
    );
    expect(rows().map((li) => li.textContent)).toEqual(["b", "c"]);
    expect(marked).toBe(1);
    // The state that belonged to "b" is on "c". That is what a key or list() prevents,
    // and what the diagnostic is for.
    expect(rows()[1]!.textContent).toBe("c");
  });
});
