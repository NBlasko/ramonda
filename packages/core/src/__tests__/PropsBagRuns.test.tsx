import { describe, expect, test, beforeEach, afterEach, vi } from "vitest";
import { getDOM } from "../test/setup";
import { Component } from "../base/Component";
import { Hook } from "../base/Hook";
import { state } from "../base/decorators";
import { bootstrap } from "../index";
import { configureDev } from "../config";
import { resetDiagnostics } from "../debug/diagnostics";

/**
 * A hook's props are a callback, and this is the measurement that says the rule costs nothing.
 *
 * A callback that reads NO signal is called once, at mount, and never again — so the bag of
 * constants that used to be written as an object literal is written as a callback for the same
 * price. That is the PRODUCTION count, and it is what this first suite measures: `test/setup.ts`
 * turns `strictRender` off for every core test. The second suite turns it back on and pins what a
 * development build adds on top. The argument for the object form was a bag full of inline functions (`fetch`,
 * `retryDelay`) that a re-run would rebuild into fresh identities and report as changed props
 * (RMD022); it only rebuilds them if the bag reads a signal.
 *
 * The last test is the mirror that keeps the first two honest: a bag that DOES read a signal
 * re-runs, and its functions are fresh each time. Without it the pair above reads as "callbacks
 * never re-run", which is the opposite of the point.
 */
describe("how often a props callback runs", () => {
  test("a bag that reads no signal is built once, however often the owner renders", async () => {
    let runs = 0;
    class Echo extends Hook<{ label: string }> {
      get seen() {
        return this.props.label;
      }
    }
    class Page extends Component {
      @state n = 1;
      fixed = this.use(Echo, () => {
        runs++;
        return { label: "prices" };
      });
      render() {
        return (
          <p>
            {this.fixed.seen}/{this.n}
          </p>
        );
      }
    }

    const app = await getDOM<Page>(<Page />);
    expect(runs).toBe(1);

    for (let i = 0; i < 5; i++) {
      app.instance.n = i;
      await app.settle();
    }
    expect(runs).toBe(1);
  });

  test("inline functions in such a bag keep their identity, so nothing is reported as changed", async () => {
    let identityChanges = 0;
    class Q extends Hook<{ fetch: () => string }> {
      private last: unknown;
      check() {
        if (this.last !== undefined && this.last !== this.props.fetch) identityChanges++;
        this.last = this.props.fetch;
      }
    }
    class Page extends Component {
      @state n = 1;
      q = this.use(Q, () => ({ fetch: () => "x" }));
      render() {
        this.q.check();
        return <p>{this.n}</p>;
      }
    }

    const app = await getDOM<Page>(<Page />);
    for (let i = 0; i < 5; i++) {
      app.instance.n = i;
      await app.settle();
    }
    expect(identityChanges).toBe(0);
  });

  /** The case `@StableProps` exists for. */
  test("a bag that reads a signal re-runs, and its inline functions are fresh each time", async () => {
    let runs = 0;
    let identityChanges = 0;
    class Q extends Hook<{ fetch: () => string; key: number }> {
      private last: unknown;
      check() {
        if (this.last !== undefined && this.last !== this.props.fetch) identityChanges++;
        this.last = this.props.fetch;
      }
    }
    class Page extends Component {
      @state n = 1;
      q = this.use(Q, (self: Page) => {
        runs++;
        return { fetch: () => "x", key: self.n };
      });
      render() {
        this.q.check();
        return <p>{this.n}</p>;
      }
    }

    const app = await getDOM<Page>(<Page />);
    for (let i = 0; i < 5; i++) {
      app.instance.n = i;
      await app.settle();
    }
    expect(runs).toBe(6);
    expect(identityChanges).toBe(5);
  });
});

describe("a plain object is refused (RMD055)", () => {
  let records: RamondaDiagnostic[] = [];

  beforeEach(() => {
    records = [];
    resetDiagnostics();
    vi.spyOn(console, "error").mockImplementation(() => {});
    globalThis.__RAMONDA_DIAGNOSTICS__ = (record) => records.push(record);
  });

  afterEach(() => {
    globalThis.__RAMONDA_DIAGNOSTICS__ = undefined;
    vi.restoreAllMocks();
  });

  class Echo extends Hook<{ seed: number }> {
    get seed() {
      return this.props.seed;
    }
  }

  test("an object bag throws, naming the owner and the hook", () => {
    class Page extends Component {
      @state n = 1;
      // The mistake: evaluated once, so `seed` could only ever be 1.
      echo = this.use(Echo, { seed: this.n } as never);
      render() {
        return <p>{String(this.echo.seed)}</p>;
      }
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    try {
      expect(() => bootstrap(<Page />, container)).toThrow(/RMD055.*Echo.*Page/s);
    } finally {
      container.remove();
    }
  });

  test("the report carries the keys the object held", () => {
    class Page extends Component {
      echo = this.use(Echo, { seed: 1 } as never);
      render() {
        return <p />;
      }
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    try {
      expect(() => bootstrap(<Page />, container)).toThrow();
    } finally {
      container.remove();
    }

    const record = records.find((r) => r.code === "RMD055");
    expect(record?.severity).toBe("error");
    expect(record?.data?.keys).toBe("seed");
    expect(record?.dedupKey).toBe("RMD055:Page:Echo");
  });

  test("a hook taking no props at all is untouched", async () => {
    class Silent extends Hook {
      readonly answer = 42;
    }
    class Page extends Component {
      silent = this.use(Silent);
      render() {
        return <p>{String(this.silent.answer)}</p>;
      }
    }

    const app = await getDOM<Page>(<Page />);
    expect(app.container.textContent).toBe("42");
    expect(records.some((r) => r.code === "RMD055")).toBe(false);
  });
});

/**
 * The same questions under the DEFAULT development configuration, where `strictRender` is on.
 *
 * The suite above runs with it off — `test/setup.ts` turns it off for every core test, because the
 * checks it enables observe render order by rendering twice, which is the impurity they report. So
 * the counts above are the production ones, and an app running `pnpm dev` sees what is pinned here.
 */
describe("a bag of constants under the default dev configuration", () => {
  let records: RamondaDiagnostic[] = [];

  beforeEach(() => {
    records = [];
    resetDiagnostics();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    globalThis.__RAMONDA_DIAGNOSTICS__ = (record) => records.push(record);
    configureDev({ strictRender: true });
  });

  afterEach(() => {
    configureDev({ strictRender: false });
    globalThis.__RAMONDA_DIAGNOSTICS__ = undefined;
    vi.restoreAllMocks();
  });

  const codes = () => records.map((record) => record.code);

  /**
   * Two calls at mount and one per render, and neither is the hook being handed anything.
   *
   * The pair at mount is RMD022's comparison — the only way to find a value that is not a function
   * of state is to build the bag twice and look. The one per render is RMD027's freshness probe,
   * which asks whether a cache that says "nothing moved" is telling the truth. Both results are
   * thrown away, which is what the identity assertion below is checking.
   */
  test("the callback is called twice at mount and once per render, and the hook sees one bag", async () => {
    let runs = 0;
    let identityChanges = 0;
    class Echo extends Hook<{ label: string; act: () => void }> {
      private last: unknown;
      check() {
        if (this.last !== undefined && this.last !== this.props.act) identityChanges++;
        this.last = this.props.act;
      }
    }
    class Page extends Component {
      @state n = 1;
      fixed = this.use(Echo, () => {
        runs++;
        return { label: "prices", act: () => {} };
      });
      render() {
        this.fixed.check();
        return <p>{String(this.n)}</p>;
      }
    }

    const app = await getDOM<Page>(<Page />);
    expect(runs).toBe(2);

    for (let i = 0; i < 5; i++) {
      app.instance.n = i;
      await app.settle();
    }
    expect(runs).toBe(7);
    expect(identityChanges).toBe(0);
    expect(codes()).toEqual([]);
  });

  /**
   * The report this suite exists for. A bag carrying JSX is two levels past `valueEqual`'s default
   * bound, so the comparison answers "different" without having found a difference — and every such
   * bag was told it "does not come from state", with advice about `Math.random()` under it.
   */
  test("a bag carrying JSX is not reported as instability", async () => {
    class Boxed extends Hook<{ children: unknown }> {
      get kids() {
        return this.props.children;
      }
    }
    class Page extends Component {
      @state n = 1;
      box = this.use(Boxed, () => ({
        children: (
          <div>
            <h2>Title</h2>
          </div>
        ),
      }));
      render() {
        return <p>{String(this.n)}</p>;
      }
    }

    const app = await getDOM<Page>(<Page />);
    for (let i = 0; i < 3; i++) {
      app.instance.n = i;
      await app.settle();
    }
    expect(codes()).toEqual([]);
  });

  /**
   * The counter-case, and the reason the exemption above is about CHURN alone.
   *
   * A callback that reads no signal is never called again, so it cannot churn — but that is exactly
   * where a value which is not a function of state does its worst: it is frozen into the cache at
   * mount and served for the life of the hook. Exempting this too was the first spelling of the fix,
   * and it silenced two of core's own RMD022 tests.
   */
  test("a value that is not a function of state is still reported", async () => {
    let n = 0;
    class Echo extends Hook<{ count: number }> {
      get seen() {
        return this.props.count;
      }
    }
    class Page extends Component {
      probe = this.use(Echo, () => ({ count: n++ }));
      render() {
        return <p>{String(this.probe.seen)}</p>;
      }
    }

    await getDOM<Page>(<Page />);
    expect(codes()).toContain("RMD022");
  });
});
