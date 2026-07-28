import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { getDOM } from "../test/setup";
import { Component } from "../base/Component";
import { Hook } from "../base/Hook";
import { list } from "../base/list";
import { compute, memoizedHandler, state } from "../base/decorators";
import { resetDiagnostics } from "../debug/diagnostics";
import { configureDev } from "../index";

/**
 * RMD020 — the development build renders every component twice and reports what
 * came out different.
 *
 * Two calls in the SAME tick, with no state change between them, cannot confuse
 * "created in place" with "genuinely changed": any difference was built by the
 * render itself. That is what makes this precise where comparing against the
 * previous render is not.
 *
 * The framework's own suites turn the check off (see `test/setup.ts` — they log
 * from `render()` to observe order, which is the very impurity this reports), so
 * these tests turn it back on for themselves.
 */

let logs: string[] = [];

beforeEach(() => {
  configureDev({ strictRender: true });
  resetDiagnostics();
  logs = [];
  // `ramondaLog` writes on console.log — that is the devtools Logs channel too.
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  });
});

afterEach(() => {
  configureDev({ strictRender: false });
  vi.restoreAllMocks();
});

function reported(): string {
  return logs.join("\n");
}

describe("RMD020 — values built inside render()", () => {
  test("an inline handler is reported, and named", async () => {
    class Panel extends Component {
      @state count = 0;
      render() {
        return (
          <button type="button" onClick={() => this.count++}>
            {String(this.count)}
          </button>
        );
      }
    }

    await getDOM<Panel>(<Panel />);

    expect(reported()).toContain("RMD020");
    expect(reported()).toContain("onClick");
    // The source is identical between the two calls — only the identity is fresh,
    // which is exactly how "built in place" is told apart from "a different value".
    expect(reported()).toContain("the source is the same");
  });

  test("a bound method is not reported", async () => {
    class Panel extends Component {
      @state count = 0;
      bump() {
        this.count++;
      }
      render() {
        return (
          <button type="button" onClick={this.bump}>
            {String(this.count)}
          </button>
        );
      }
    }

    await getDOM<Panel>(<Panel />);
    expect(reported()).not.toContain("RMD020");
  });

  test("@memoizedHandler is not reported — it is the cure, not the disease", async () => {
    class Row extends Component {
      @state selected = 0;

      @memoizedHandler
      select(id: number) {
        return () => {
          this.selected = id;
        };
      }

      render() {
        return (
          <ul>
            <li onClick={this.select(1)}>one</li>
            <li onClick={this.select(2)}>two</li>
          </ul>
        );
      }
    }

    await getDOM<Row>(<Row />);
    // Same arguments, same function back — so the second render produces identical
    // identities and the check passes it.
    expect(reported()).not.toContain("RMD020");
  });

  test("an inline object prop is reported", async () => {
    class Panel extends Component {
      render() {
        return <div style={{ color: "red" }}>hi</div>;
      }
    }

    await getDOM<Panel>(<Panel />);

    expect(reported()).toContain("RMD020");
    expect(reported()).toContain("style");
    expect(reported()).toContain("new object or array");
  });

  test("a @compute holding the object is not reported", async () => {
    class Panel extends Component {
      @state red = true;

      @compute get style() {
        return { color: this.red ? "red" : "blue" };
      }

      render() {
        return <div style={this.style}>hi</div>;
      }
    }

    await getDOM<Panel>(<Panel />);
    // The second read is a cache hit, so the identity is stable — which is the fix
    // the report points at.
    expect(reported()).not.toContain("RMD020");
  });

  test("a non-deterministic render is reported without waiting for hydration", async () => {
    class Clock extends Component {
      render() {
        return <span data-at={String(Math.random())}>now</span>;
      }
    }

    await getDOM<Clock>(<Clock />);

    expect(reported()).toContain("RMD020");
    expect(reported()).toContain("does not come from state");
  });

  test("a rebuilt list `each` is reported — the row-identity killer", async () => {
    const source = [
      { id: 1, label: "a" },
      { id: 2, label: "b" },
    ];

    class Table extends Component {
      render() {
        return (
          <ul>
            {list({
              // A fresh array of fresh objects every render: every row gets a new
              // minted id, every key misses, and the whole list is rebuilt.
              each: source.map((row) => ({ ...row })),
              render: (row: { label: string }) => <li>{row.label}</li>,
            })}
          </ul>
        );
      }
    }

    await getDOM<Table>(<Table />);

    expect(reported()).toContain("RMD020");
    expect(reported()).toContain("each");
    expect(reported()).toContain("loses its identity");
  });

  test("a stable list `each` is not reported", async () => {
    const source = [
      { id: 1, label: "a" },
      { id: 2, label: "b" },
    ];

    class Table extends Component {
      render() {
        return (
          <ul>
            {list({
              each: source,
              render: (row: { label: string }) => <li>{row.label}</li>,
            })}
          </ul>
        );
      }
    }

    await getDOM<Table>(<Table />);
    // `render` is a fresh arrow too — but it is the list's mapper, declared inline
    // by design, and it is compared as part of `options`. It differs, so it IS
    // reported; what must not be reported is `each`.
    expect(reported()).not.toContain("loses its identity");
  });

  test("it reports once per place, not once per render", async () => {
    class Panel extends Component {
      @state count = 0;
      render() {
        return (
          <button type="button" onClick={() => this.count++}>
            {String(this.count)}
          </button>
        );
      }
    }

    const { instance, settle } = await getDOM<Panel>(<Panel />);
    instance.count = 1;
    await settle();
    instance.count = 2;
    await settle();

    const occurrences = reported().split("RMD020").length - 1;
    // Three renders, one report: `diagnose` dedupes by code + source, which is what
    // makes checking every render livable.
    expect(occurrences).toBe(1);
  });

  test("branches are covered, because every render is checked", async () => {
    class Panel extends Component {
      @state open = false;
      render() {
        return (
          <div>
            {this.open ? (
              <button type="button" onClick={() => (this.open = false)}>
                close
              </button>
            ) : null}
          </div>
        );
      }
    }

    const { instance, settle } = await getDOM<Panel>(<Panel />);
    // Nothing yet: the handler does not exist while the branch is not taken. This
    // is the case "check only the first render" would have missed forever.
    expect(reported()).not.toContain("RMD020");

    instance.open = true;
    await settle();

    expect(reported()).toContain("RMD020");
    expect(reported()).toContain("onClick");
  });

  test("the report names the component", async () => {
    class VeryParticularPanel extends Component {
      render() {
        return <div style={{ color: "red" }}>hi</div>;
      }
    }

    await getDOM<VeryParticularPanel>(<VeryParticularPanel />);
    expect(reported()).toContain("VeryParticularPanel");
  });
});

describe("RMD020 — values built inside a hook's props callback", () => {
  class Sink extends Hook<{ config: { size: number }; label: string }> {
    get size(): number {
      return this.props.config.size;
    }
  }

  test("a rebuilt props object is reported, and the hook is named", async () => {
    class Panel extends Component {
      @state size = 1;
      sink = this.use(Sink, (self: Panel) => ({
        config: { size: self.size },
        label: "fixed",
      }));

      render() {
        return <div>{String(this.sink.size)}</div>;
      }
    }

    await getDOM<Panel>(<Panel />);

    expect(reported()).toContain("RMD020");
    expect(reported()).toContain("Sink");
    expect(reported()).toContain("config");
  });

  test("scalar props are not reported", async () => {
    class Flat extends Hook<{ size: number; label: string }> {
      get size(): number {
        return this.props.size;
      }
    }

    class Panel extends Component {
      @state size = 1;
      sink = this.use(Flat, (self: Panel) => ({ size: self.size, label: "fixed" }));

      render() {
        return <div>{String(this.sink.size)}</div>;
      }
    }

    await getDOM<Panel>(<Panel />);
    expect(reported()).not.toContain("RMD020");
  });

  test("a @compute bag is the cure here too", async () => {
    class Panel extends Component {
      @state size = 1;

      @compute get config() {
        return { size: this.size };
      }

      sink = this.use(Sink, (self: Panel) => ({ config: self.config, label: "fixed" }));

      render() {
        return <div>{String(this.sink.size)}</div>;
      }
    }

    await getDOM<Panel>(<Panel />);
    expect(reported()).not.toContain("RMD020");
  });
});

describe("the switch", () => {
  test("nothing is checked when it is off", async () => {
    configureDev({ strictRender: false });

    class Panel extends Component {
      render() {
        return <div style={{ color: "red" }}>hi</div>;
      }
    }

    await getDOM<Panel>(<Panel />);
    expect(reported()).not.toContain("RMD020");
  });

  test("render really does run twice while it is on", async () => {
    let renders = 0;

    class Panel extends Component {
      render() {
        renders++;
        return <div>hi</div>;
      }
    }

    await getDOM<Panel>(<Panel />);

    // The honest cost, and the honest hazard: a render with a side effect runs it
    // twice. RMD001 already makes a state write there an error; anything else is
    // the check working, not a malfunction.
    expect(renders).toBe(2);
  });
});
