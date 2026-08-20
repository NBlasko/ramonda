import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { getDOM } from "../test/setup";
import { Component } from "../base/Component";
import { state } from "../base/decorators";
import { list } from "../base/list";
import { resetDiagnostics } from "../debug/diagnostics";
import { configureDev } from "../index";

/**
 * RMD020 inside a ROW — the two positions the double render used to miss, and why it missed them.
 *
 * `h.ts` wraps any array in children position into the same `IS_LIST`-branded shape a `list()` has,
 * and the comparison had one branch for both: compare `each`, then stop. That was written for a
 * `list()` DESCRIPTOR, whose builder has not run and whose rows do not exist yet. A `.map()` region
 * is the opposite — its rows are already built and sitting in `vnodes`, in both outputs — and they
 * were thrown away. Measured before this: an inline handler on an `<li>` was reported when the `<li>`
 * was written by hand and silent the moment it came from an array.
 *
 * A `list()` row genuinely cannot be compared from a render, because the builder is called by the
 * engine during the diff. `listEngine.ts` does it there instead, which is also the cheap place:
 * ```
 * 100 rows, stable callback, mount then 3 re-renders
 * strictRender on:   200 builds on mount, 200 after three more renders
 * strictRender off:  100                  100
 * ```
 * Exactly twice for the rows that are BUILT, and nothing at all afterwards — a reused row is never
 * rebuilt, so the check is not paid for it.
 */

let logs: string[] = [];

beforeEach(() => {
  configureDev({ strictRender: true });
  resetDiagnostics();
  logs = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  });
});

afterEach(() => {
  configureDev({ strictRender: false });
  vi.restoreAllMocks();
});

const reported = (): string => logs.join("\n");
const reports = (): number => logs.filter((l) => l.includes("RMD020")).length;

interface Task {
  id: string;
}
const TWO: Task[] = [{ id: "a" }, { id: "b" }];
const FIFTY: Task[] = Array.from({ length: 50 }, (_, i) => ({ id: `r${i}` }));

describe("a `.map()` region, whose rows are already built", () => {
  test("an inline handler on a mapped row is reported", async () => {
    class Page extends Component {
      render() {
        return (
          <ul>
            {TWO.map((t) => (
              <li key={t.id} onclick={() => t.id}>
                {t.id}
              </li>
            ))}
          </ul>
        );
      }
    }

    await getDOM<Page>(<Page />);

    expect(reported()).toContain("li.onclick");
    expect(reported()).toContain("the source is the same");
  });

  test("a rebuilt object on a mapped row is reported", async () => {
    class Page extends Component {
      render() {
        return (
          <ul>
            {TWO.map((t) => (
              <li key={t.id} data-x={{ n: 1 } as never}>
                {t.id}
              </li>
            ))}
          </ul>
        );
      }
    }

    await getDOM<Page>(<Page />);

    expect(reported()).toContain("li.data-x");
    expect(reported()).toContain("with the same contents");
  });

  test("a stable callback builds nothing, so nothing is reported", async () => {
    class Page extends Component {
      bound = (t: Task) => <li key={t.id}>{t.id}</li>;
      render() {
        return <ul>{TWO.map(this.bound)}</ul>;
      }
    }

    await getDOM<Page>(<Page />);

    expect(reported()).not.toContain("RMD020");
  });

  test("fifty rows from one callback is ONE report, not fifty", async () => {
    class Page extends Component {
      render() {
        return (
          <ul>
            {FIFTY.map((t) => (
              <li key={t.id} onclick={() => t.id}>
                {t.id}
              </li>
            ))}
          </ul>
        );
      }
    }

    await getDOM<Page>(<Page />);

    // The row index is deliberately left out of the path: `diagnose` keys a report by owner, path
    // and kind, so an index would turn one mistake in one callback into one report per row.
    expect(reports()).toBe(1);
  });

  test("a thousand rows with the mistake on the LAST one is still reported", async () => {
    // The walk's node budget bounds one deep or wide TREE. Shared across a run of rows it truncated
    // instead: measured, this went silent at around row 500. Each row is its own walk now, the way a
    // `list()` row already was.
    const many = Array.from({ length: 1000 }, (_, i) => ({ id: `r${i}` }));

    class Page extends Component {
      render() {
        return (
          <ul>
            {many.map((t, i) => (
              <li key={t.id} onclick={i === many.length - 1 ? () => t.id : undefined}>
                {t.id}
              </li>
            ))}
          </ul>
        );
      }
    }

    await getDOM<Page>(<Page />);

    expect(reported()).toContain("li.onclick");
    expect(reports()).toBe(1);
  });

  test("an array literal with two DIFFERENT mistakes still reports both", async () => {
    class Page extends Component {
      render() {
        return <ul>{[<li onclick={() => 1}>a</li>, <li data-x={{ n: 1 } as never}>b</li>]}</ul>;
      }
    }

    await getDOM<Page>(<Page />);

    // Dropping the index does not merge these: the tag and the attribute name are still in the path,
    // so two rows that are wrong in two ways separate themselves.
    expect(reports()).toBe(2);
  });
});

describe("a `list()` row, built by the engine", () => {
  test("an inline handler inside a row callback is reported", async () => {
    class Page extends Component {
      row(t: Task) {
        return <li onclick={() => t.id}>{t.id}</li>;
      }
      render() {
        return <ul>{list(TWO, this.row)}</ul>;
      }
    }

    await getDOM<Page>(<Page />);

    expect(reported()).toContain("row > li.onclick");
    expect(reported()).toContain("the source is the same");
  });

  test("an inline callback with an inline handler is reported too", async () => {
    class Page extends Component {
      render() {
        return (
          <ul>
            {list(TWO, (t) => (
              <li onclick={() => t.id}>{t.id}</li>
            ))}
          </ul>
        );
      }
    }

    await getDOM<Page>(<Page />);

    expect(reported()).toContain("row > li.onclick");
  });

  test("a row whose every value is stable is not reported", async () => {
    class Page extends Component {
      pick() {
        return;
      }
      row(t: Task) {
        return <li onclick={this.pick}>{t.id}</li>;
      }
      render() {
        return <ul>{list(TWO, this.row)}</ul>;
      }
    }

    await getDOM<Page>(<Page />);

    expect(reported()).not.toContain("RMD020");
  });

  test("fifty rows is ONE report", async () => {
    class Page extends Component {
      row(t: Task) {
        return <li onclick={() => t.id}>{t.id}</li>;
      }
      render() {
        return <ul>{list(FIFTY, this.row)}</ul>;
      }
    }

    await getDOM<Page>(<Page />);

    expect(reports()).toBe(1);
  });
});

describe("what the second build costs", () => {
  class Counted extends Component {
    static builds = 0;
    @state tick = 0;
    row(t: Task) {
      Counted.builds++;
      return <li>{t.id}</li>;
    }
    render() {
      return (
        <ul>
          {list(FIFTY, this.row)}
          <li id="t">{String(this.tick)}</li>
        </ul>
      );
    }
  }

  test("twice for a row that is BUILT, and nothing for one that is reused", async () => {
    Counted.builds = 0;
    const app = await getDOM<Counted>(<Counted />);
    expect(Counted.builds).toBe(FIFTY.length * 2);

    // Three more renders driven by a signal no row reads. Every row is reused, so the builder is
    // not called — and neither is the check.
    for (let i = 0; i < 3; i++) {
      app.instance.tick++;
      await app.settle();
    }
    expect(Counted.builds).toBe(FIFTY.length * 2);
  });

  test("nothing at all when the check is off", async () => {
    configureDev({ strictRender: false });
    Counted.builds = 0;
    await getDOM<Counted>(<Counted />);
    expect(Counted.builds).toBe(FIFTY.length);
  });
});
