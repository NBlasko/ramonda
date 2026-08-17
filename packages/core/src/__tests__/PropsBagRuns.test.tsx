import { describe, expect, test } from "vitest";
import { getDOM } from "../test/setup";
import { Component } from "../base/Component";
import { Hook } from "../base/Hook";
import { state } from "../base/decorators";

/**
 * How often a hook's props CALLBACK runs, and what that costs a bag holding inline functions.
 *
 * `/hooks/writing` says the two forms plainly — a plain object is "fixed for the life of the hook,
 * for constants", a callback "re-runs whenever a signal it reads moves". What it does not say, and
 * what decides whether the object form is worth having at all, is what a callback costs when it
 * reads NOTHING: measured here, one run, at mount, and never again.
 *
 * That matters because the usual argument for reaching for the object form is a bag full of inline
 * functions — `fetch`, `retryDelay` — that a re-run would rebuild into fresh identities and report
 * as changed props (RMD022). It only rebuilds them if the bag reads a signal. A bag of constants
 * and closures that read nothing is built once either way.
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

  /**
   * The mirror, and what keeps the two above honest: a bag that DOES read a signal re-runs, and its
   * inline functions are fresh every time. That is the case `@StableProps` exists for — and without
   * this test the pair above would read as "callbacks never re-run", which is the opposite of the
   * point.
   */
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
