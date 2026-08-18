import { describe, expect, test, beforeEach, afterEach, vi } from "vitest";
import { getDOM } from "../test/setup";
import { Component } from "../base/Component";
import { Hook } from "../base/Hook";
import { state } from "../base/decorators";
import { bootstrap } from "../index";
import { resetDiagnostics } from "../debug/diagnostics";

/**
 * A hook's props are a callback, and this is the measurement that says the rule costs nothing.
 *
 * A callback that reads NO signal is called once, at mount, and never again — so the bag of
 * constants that used to be written as an object literal is written as a callback for the same
 * price. The argument for the object form was a bag full of inline functions (`fetch`,
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
