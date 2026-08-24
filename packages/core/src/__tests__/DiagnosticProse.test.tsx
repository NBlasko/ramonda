import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { getDOM } from "../test/setup";
import { Component } from "../base/Component";
import { resetDiagnostics } from "../debug/diagnostics";

/**
 * The claims a diagnostic's own prose makes, asserted against what the code does.
 *
 * A fix text is read by one person, once, at the moment they are already confused — so nothing
 * exercises it, and three of them were found saying the opposite of what the code did. These are
 * the claims that CAN be pinned: the sentence says a thing happens, so the test makes it happen and
 * reads the result back.
 *
 * It is not a spelling test. Each one below stands for a fault an audit found by reading, and would
 * have passed silently for as long as nobody read it again.
 */

let records: RamondaDiagnostic[] = [];

beforeEach(() => {
  records = [];
  resetDiagnostics();
  vi.spyOn(console, "log").mockImplementation(() => {});
  globalThis.__RAMONDA_DIAGNOSTICS__ = (record) => records.push(record);
});

afterEach(() => {
  globalThis.__RAMONDA_DIAGNOSTICS__ = undefined;
  vi.restoreAllMocks();
});

const of = (code: string) => records.find((record) => record.code === code);
const all = (code: string) => records.filter((record) => record.code === code);

/**
 * RMD039 said `class` "is passed through to the element as an unknown attribute and the styling it
 * names never applies". It was never true: `normalizeClassName` has renamed it since the first
 * commit, so the element IS styled and the report was about working code.
 *
 * What the rename cannot save is the two cases below it.
 */
describe("RMD039 — what writing `class` actually costs", () => {
  test("the styling applies, and the report says so rather than the opposite", async () => {
    class Styled extends Component {
      render() {
        return (
          <p class="lead" id="p">
            text
          </p>
        );
      }
    }
    const { container, unmount } = await getDOM(<Styled />);

    expect(container.querySelector("#p")?.className).toBe("lead");
    expect(of("RMD039")?.fix).not.toContain("never applies");
    expect(of("RMD039")?.message).toContain("className");
    expect(of("RMD039")?.data?.dropped).toBe(false);
    unmount();
  });

  test("with `className` beside it the `class` is dropped, and that report says THAT", async () => {
    class Both extends Component {
      render() {
        return (
          <p class="from-class" className="from-className" id="p">
            text
          </p>
        );
      }
    }
    const { container, unmount } = await getDOM(<Both />);

    expect(container.querySelector("#p")?.className).toBe("from-className");
    expect(of("RMD039")?.data?.dropped).toBe(true);
    expect(of("RMD039")?.message).toContain("dropped");
    unmount();
  });

  /**
   * The one `@ramonda/check` skipped, on the reasoning that a component's `class` is "a prop that
   * component defined". The rename runs for every tag, so the component never receives `class` at
   * all — a `class` prop it declared reads `undefined` on every render, for ever.
   */
  test("a component never receives it either, whatever it declared", async () => {
    let seen: { class?: string; className?: string } = {};

    class Panel extends Component<{ class?: string; className?: string }> {
      render() {
        seen = { class: this.props.class, className: this.props.className };
        return <span />;
      }
    }
    class App extends Component {
      render() {
        return <Panel class="row" />;
      }
    }
    const { unmount } = await getDOM(<App />);

    expect(seen.class).toBeUndefined();
    expect(seen.className).toBe("row");
    expect(of("RMD039")?.data?.tag).toBe("Panel");
    expect(of("RMD039")?.message).toContain("prop");
    unmount();
  });
});

/**
 * RMD021's title promised "A clock or a random number", and the guard has never watched a clock —
 * `installPurityGuard` patches `Math.random` and `crypto` and nothing else, deliberately, because a
 * patched clock reports calls the platform made rather than the app.
 */
describe("RMD021 — randomness, and no clock", () => {
  test("`Date.now()` in a render is not this code, and the prose does not claim it", async () => {
    class Clock extends Component {
      render() {
        return <span>{String(Date.now())}</span>;
      }
    }
    const { unmount } = await getDOM(<Clock />);

    expect(all("RMD021")).toHaveLength(0);
    unmount();
  });

  test("all four phases it fires in are named in the fix", async () => {
    class Dice extends Component {
      render() {
        return <span>{String(Math.random())}</span>;
      }
    }
    const { unmount } = await getDOM(<Dice />);

    const fix = of("RMD021")?.fix ?? "";
    expect(fix).toContain("@compute");
    expect(fix).toContain("@memoized");
    expect(fix).toContain("props callback");
    expect(fix).toContain("render()");
    unmount();
  });
});

/**
 * RMD010's fix named "list elements" among the parents that only accept specific children. They
 * are the ones it deliberately does NOT report: measured, the parser leaves an unknown element
 * inside a `<ul>` alone, and warning there would fire on the commonest list in any app.
 */
describe("RMD010 — the parents it really speaks about", () => {
  test("a default host inside a <ul> is silent, and a <tbody> is not", async () => {
    class Row extends Component {
      render() {
        return <span>row</span>;
      }
    }
    class InAList extends Component {
      render() {
        return (
          <ul>
            <Row />
          </ul>
        );
      }
    }
    const list = await getDOM(<InAList />);
    expect(all("RMD010")).toHaveLength(0);
    list.unmount();

    class InATable extends Component {
      render() {
        return (
          <table>
            <Row />
          </table>
        );
      }
    }
    const table = await getDOM(<InATable />);
    expect(all("RMD010").length).toBeGreaterThan(0);
    expect(of("RMD010")?.fix).not.toContain("list elements");
    table.unmount();
  });
});
