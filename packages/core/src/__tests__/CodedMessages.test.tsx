import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { getDOM } from "../test/setup";
import { onElement, shouldUpdateOnPropsChange, state, watchProp } from "../base/decorators";
import { Component } from "../base/Component";
import { resetDiagnostics } from "../debug/diagnostics";

/**
 * The codes that used to be bare messages, triggered through the code that raises them.
 *
 * Ten `ramondaLog` calls became `RMD032`–`RMD041`, and a suite that still passes proves only that
 * nothing regressed — not that a converted call site fires, names the right code, or builds a
 * sensible dedup key. Each of these is the real path: a component, a render, an event.
 *
 * The four hydration codes are not here. They need a server render and a blob to hydrate from, which
 * `src/__tests__/hydration/` already sets up — this file covers the six a single mount reaches.
 */

let records: RamondaDiagnostic[] = [];

beforeEach(() => {
  records = [];
  resetDiagnostics();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  globalThis.__RAMONDA_DIAGNOSTICS__ = (record) => records.push(record);
});

afterEach(() => {
  globalThis.__RAMONDA_DIAGNOSTICS__ = undefined;
  vi.restoreAllMocks();
});

const codes = () => records.map((record) => record.code);
const of = (code: string) => records.find((record) => record.code === code);

describe("the ten that were messages", () => {
  test("RMD036 — an object among JSX children", async () => {
    class Bad extends Component {
      render() {
        // A whole object where one of its fields belongs. It is dropped, so the page renders
        // without it — which is the reason this is an error rather than a warning.
        return <p>{{ name: "Ada" } as never}</p>;
      }
    }
    const { container, unmount } = await getDOM(<Bad />);

    expect(codes()).toContain("RMD036");
    expect(of("RMD036")?.severity).toBe("error");
    expect(of("RMD036")?.data?.kind).toBe("[object Object]");
    expect(container.textContent).toBe("");
    unmount();
  });

  test("RMD038 — `class` where `className` was meant", async () => {
    class Styled extends Component {
      render() {
        return <p class="lead">text</p>;
      }
    }
    const { unmount } = await getDOM(<Styled />);

    expect(codes()).toContain("RMD038");
    expect(of("RMD038")?.severity).toBe("warn");
    expect(of("RMD038")?.fix).toContain("className");
    unmount();
  });

  test("RMD037 — a @watchProp selector that throws", async () => {
    class Child extends Component<{ deep?: { value: number } }> {
      @state seen = 0;
      // Reads through something absent, which is what the fix is about.
      @watchProp((p: { deep?: { value: number } }) => (p.deep as { value: number }).value)
      onDeep() {
        this.seen++;
      }
      render() {
        return <p>{this.seen}</p>;
      }
    }
    class Owner extends Component {
      @state n = 0;
      render() {
        return <Child deep={undefined} />;
      }
    }
    const { unmount } = await getDOM(<Owner />);

    expect(codes()).toContain("RMD037");
    expect(of("RMD037")?.severity).toBe("error");
    expect(typeof of("RMD037")?.data?.component).toBe("string");
    unmount();
  });

  test("RMD039 — more than one @shouldUpdateOnPropsChange", async () => {
    class Twice extends Component<{ id: number }> {
      @shouldUpdateOnPropsChange
      first() {
        return true;
      }
      @shouldUpdateOnPropsChange
      second() {
        return true;
      }
      render() {
        return <p>{this.props.id}</p>;
      }
    }
    const { unmount } = await getDOM(<Twice id={1} />);

    expect(codes()).toContain("RMD039");
    expect(of("RMD039")?.severity).toBe("error");
    expect(of("RMD039")?.data?.component).toBe("Twice");
    unmount();
  });

  test("RMD041 — the default host cannot be the target of this event", async () => {
    // No `@Host`, so the host is `<ramonda-host>`: `display: contents`, no box, and therefore never
    // the direct target of a pointer event.
    class OnHost extends Component {
      @onElement("mouseenter")
      onEnter() {}
      render() {
        return <p>hover me</p>;
      }
    }
    const { unmount } = await getDOM(<OnHost />);

    expect(codes()).toContain("RMD041");
    expect(of("RMD041")?.severity).toBe("warn");
    expect(of("RMD041")?.data).toMatchObject({ component: "OnHost", event: "mouseenter" });
    unmount();
  });

  /**
   * `RMD040` — a listener whose target resolver returns nothing — is not here, and the reason is
   * worth writing down rather than leaving as a gap: no supported decorator reaches it from an
   * ordinary mount. `@onElement` always resolves the host, `@onWindow` and `@onDocument` always
   * resolve a global, and a component with no host throws at construction instead. It is reachable
   * only by a resolver that gives up, which is why the check exists — but nothing in the public API
   * can produce one to test with.
   */

  test("every record these call sites produce carries a fix and a dedup key", async () => {
    class Styled extends Component {
      render() {
        return <p class="lead">{{ oops: true } as never}</p>;
      }
    }
    const { unmount } = await getDOM(<Styled />);

    // Two codes from one render, so the loop below is over something. A `for` over an empty array
    // asserts nothing, which is how a test like this passes while checking no records at all.
    expect(records.length).toBeGreaterThanOrEqual(2);

    for (const record of records) {
      expect(record.fix?.length ?? 0).toBeGreaterThan(20);
      expect(record.dedupKey).toMatch(/^RMD\d{3}:/);
      expect(record.scope).toBe("ramonda/core");
      expect(record.message.trim()).toBe(record.message);
    }
    unmount();
  });
});
