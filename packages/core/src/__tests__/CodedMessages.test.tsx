import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { getDOM } from "../test/setup";
import { ShouldUpdateOnPropsChange, state, watchProp } from "../base/decorators";
import { Component } from "../base/Component";
import { Head } from "../base/Head";
import { resetDiagnostics } from "../debug/diagnostics";

/**
 * The codes that used to be bare messages, triggered through the code that raises them.
 *
 * Ten `ramondaLog` calls became `RMD033`–`RMD042`, and a suite that still passes proves only that
 * nothing regressed — not that a converted call site fires, names the right code, or builds a
 * sensible dedup key. Each of these is the real path: a component, a render, an event.
 *
 * The hydration codes are not here — they need a server render and a blob to hydrate from, and this
 * file covers the six a single mount reaches.
 *
 * They are in `DiagnosticReach.test.tsx`. This note used to send a reader to
 * `src/__tests__/hydration/`, which was where they were MEANT to go and never did: that directory
 * names `RMD025` and nothing else, so `RMD034`, `RMD035` and `RMD036` sat unproved behind a comment
 * saying they were covered. Found by crossing what `SPECS` declares against what any test names.
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
  test("RMD037 — an object among JSX children", async () => {
    class Bad extends Component {
      render() {
        // A whole object where one of its fields belongs. It is dropped, so the page renders
        // without it — which is the reason this is an error rather than a warning.
        return <p>{{ name: "Ada" } as never}</p>;
      }
    }
    const { container, unmount } = await getDOM(<Bad />);

    expect(codes()).toContain("RMD037");
    expect(of("RMD037")?.severity).toBe("error");
    expect(of("RMD037")?.data?.kind).toBe("[object Object]");
    expect(container.textContent).toBe("");
    unmount();
  });

  test("RMD039 — `class` where `className` was meant", async () => {
    class Styled extends Component {
      render() {
        return <p class="lead">text</p>;
      }
    }
    const { unmount } = await getDOM(<Styled />);

    expect(codes()).toContain("RMD039");
    expect(of("RMD039")?.severity).toBe("warn");
    expect(of("RMD039")?.fix).toContain("className");
    unmount();
  });

  test("RMD044 — a tag that is none of the three things a tag can be", async () => {
    class Broken extends Component {
      render() {
        return <Missing />;
      }
    }
    const { unmount } = await getDOM(<Broken />);

    expect(codes()).toContain("RMD044");
    expect(of("RMD044")?.severity).toBe("error");
    expect(of("RMD044")?.data).toMatchObject({ kind: "undefined", owner: "Broken" });
    unmount();
  });

  test("RMD038 — a @watchProp selector that throws", async () => {
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

    expect(codes()).toContain("RMD038");
    expect(of("RMD038")?.severity).toBe("error");
    expect(typeof of("RMD038")?.data?.component).toBe("string");

    /**
     * The throw is the app's own, so its STACK names the failing path — the one thing the message
     * cannot give. It goes to the console, which prints `data` whole, and not into the record, where
     * a collector's bounded history would hold the scope the Error was thrown from alive.
     */
    const printed = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const withError = printed.find((call) => call.some((arg) => (arg as { error?: unknown })?.error instanceof Error));
    expect(withError).toBeDefined();
    expect(of("RMD038")?.data).toEqual({ component: "Child", reason: expect.any(String) });
    unmount();
  });

  test("RMD040 — more than one @ShouldUpdateOnPropsChange on one class", async () => {
    // Reported when the class is DEFINED, not when it renders: a class decorator applies at
    // definition, and the second application is what finds the first.
    @ShouldUpdateOnPropsChange(() => true)
    @ShouldUpdateOnPropsChange(() => true)
    class Twice extends Component<{ id: number }> {
      render() {
        return <p>{this.props.id}</p>;
      }
    }
    const { unmount } = await getDOM(<Twice id={1} />);

    expect(codes()).toContain("RMD040");
    expect(of("RMD040")?.severity).toBe("error");
    expect(of("RMD040")?.data?.component).toBe("Twice");
    // The advice has to name the right one, and which one that is reads backwards — see
    // `PropsGateInheritance.test.tsx`, which measures it.
    expect(of("RMD040")?.fix).toContain("HIGHEST");
    unmount();
  });

  /**
   * What a failed import arrives as: a tag that exists in the types and not at runtime.
   *
   * Written as a cast off a real class rather than `as never`, because `as never` is not a JSX tag as
   * far as TypeScript is concerned and would not compile. This is the shape of the mistake — the types
   * say component, the module system delivered `undefined`.
   */
  class Present extends Component {
    render() {
      return <p>here</p>;
    }
  }
  const Missing = undefined as unknown as typeof Present;

  /**
   * `RMD041` — a listener whose target resolver returns nothing — is not here, and the reason is
   * worth writing down rather than leaving as a gap: no supported decorator reaches it from an
   * ordinary mount. `@onWindow` and `@onDocument` always
   * resolve a global, and a component with no host throws at construction instead. It is reachable
   * only by a resolver that gives up, which is why the check exists — but nothing in the public API
   * can produce one to test with.
   */

  test("RMD043 — a <meta> with nothing to identify it", async () => {
    class Page extends Component {
      // `as never`: the MetaTag union makes this a type error at the call site, which is the first
      // line of defence. The runtime check is for a build with no types, and that is what this is.
      head = this.use(Head, () => ({ meta: [{ content: "A description" } as never] }));
      render() {
        return <p>page</p>;
      }
    }
    const { unmount } = await getDOM(<Page />);

    expect(codes()).toContain("RMD043");
    expect(of("RMD043")?.severity).toBe("warn");
    // The dedup key is which fields the tag HAS, so the same fault on a description that changes
    // every navigation is one report rather than one per page.
    expect(of("RMD043")?.dedupKey).toBe("RMD043:content");
    expect(of("RMD043")?.message).toContain("A description");
    unmount();
  });

  /**
   * `diagnose` reports once per key and never again, so a key that names the MISTAKE rather than the
   * place it was made silences every occurrence after the first — for the whole session, across the
   * whole application. Each of these three was written that way (`"class"`, `child:[object Object]`,
   * `tag:undefined`) and each is a mistake people make in every file they convert.
   */
  describe("one report per site, not one per application", () => {
    test("two components giving `class` are two reports", async () => {
      class First extends Component {
        render() {
          return <p class="lead">first</p>;
        }
      }
      class Second extends Component {
        render() {
          return <p class="lead">second</p>;
        }
      }
      class Both extends Component {
        render() {
          return (
            <div>
              <First />
              <Second />
            </div>
          );
        }
      }
      const { unmount } = await getDOM(<Both />);

      const owners = records.filter((r) => r.code === "RMD039").map((r) => r.data?.owner);
      expect(owners).toEqual(["First", "Second"]);
      // And the same site twice is still one report — the dedup is doing its job, not switched off.
      expect(records.filter((r) => r.code === "RMD039")).toHaveLength(2);
      unmount();
    });

    test("two components rendering an object child are two reports", async () => {
      class First extends Component {
        render() {
          return <p>{{ name: "Ada" } as never}</p>;
        }
      }
      class Second extends Component {
        render() {
          return <p>{{ name: "Grace" } as never}</p>;
        }
      }
      class Both extends Component {
        render() {
          return (
            <div>
              <First />
              <Second />
            </div>
          );
        }
      }
      const { unmount } = await getDOM(<Both />);

      expect(records.filter((r) => r.code === "RMD037").map((r) => r.data?.owner)).toEqual(["First", "Second"]);
      unmount();
    });

    test("two components with an unknown tag are two reports", async () => {
      class First extends Component {
        render() {
          return <Missing />;
        }
      }
      class Second extends Component {
        render() {
          return <Missing />;
        }
      }
      class Both extends Component {
        render() {
          return (
            <div>
              <First />
              <Second />
            </div>
          );
        }
      }
      const { unmount } = await getDOM(<Both />);

      expect(records.filter((r) => r.code === "RMD044").map((r) => r.data?.owner)).toEqual(["First", "Second"]);
      unmount();
    });
  });

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
