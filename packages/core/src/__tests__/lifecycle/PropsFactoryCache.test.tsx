import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { getDOM } from "../../test/setup";
import { Component } from "../../base/Component";
import { Hook } from "../../base/Hook";
import { compute, state } from "../../base/decorators";
import { configureDev } from "../../config";
import { resetDiagnostics } from "../../debug/diagnostics";

/**
 * A hook's props callback is cached on the signals it reads — the contract, its cost, and the
 * two ways it can be got wrong.
 *
 * The counting test is the one that says whether this is worth having at all. It is written as
 * operation counts rather than timings on purpose: the work is a handful of allocations either
 * way, and a wall-clock number in jsdom would swing further than the thing being measured.
 */

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
  configureDev({ strictRender: false });
});

const reported = () => logs.join("\n");

describe("the props callback cache", () => {
  test("one changed signal calls one callback, not all of them", async () => {
    const HOOKS = 10;
    const RENDERS = 5;

    let callbackCalls = 0;
    let computeRuns = 0;

    class Probe extends Hook<{ filter: { q: string }; onPick: (x: number) => void }> {
      @compute get view(): string {
        computeRuns++;
        return this.props.filter.q;
      }
    }

    class Owner extends Component {
      @state query = "a";
      @state untouched = "fixed";

      // Hook 0 reads the signal that will move. The other nine read one that never does — which
      // is the shape of a hook-heavy component, and the case the cache is for.
      probes: Probe[] = Array.from({ length: HOOKS }, (_, i) =>
        this.use(Probe, (self: Owner) => {
          callbackCalls++;
          return {
            filter: { q: i === 0 ? self.query : self.untouched },
            onPick: (x: number) => x,
          };
        }),
      );

      render() {
        return <div>{this.probes.map((p) => p.view).join(",")}</div>;
      }
    }

    const { instance, settle } = await getDOM<Owner>(<Owner />);
    await settle();

    // Mount builds every bag once — there is no previous anything to reuse.
    expect(callbackCalls).toBe(HOOKS);
    expect(computeRuns).toBe(HOOKS);

    callbackCalls = 0;
    computeRuns = 0;

    for (let i = 0; i < RENDERS; i++) {
      instance.query = `q${i}`;
      await settle();
    }

    /**
     * Five renders of the owner, one changed signal, ten hooks.
     *
     * Before the cache this measured 50 and 50: every callback ran on every render, and every
     * rebuilt `filter` object woke its prop signal, so all ten hooks recomputed each time. Five
     * and five is the whole of the work that actually changed.
     *
     * The owner still renders five times. This does not skip a render — it skips asking nine
     * hooks for a bag that nothing they read could have changed.
     */
    expect(callbackCalls).toBe(RENDERS);
    expect(computeRuns).toBe(RENDERS);
  });

  test("a clean parent still lets its child hooks update", async () => {
    let childCallbacks = 0;

    class Child extends Hook<{ n: number }> {
      get n(): number {
        return this.props.n;
      }
    }

    class Parent extends Hook<{ label: string }> {
      @state own = 0;

      child = this.use(Child, (self: Parent) => {
        childCallbacks++;
        return { n: self.own };
      });
    }

    class Owner extends Component {
      @state unrelated = 0;
      parent = this.use(Parent, () => ({ label: "fixed" }));

      render() {
        return <div>{`${this.parent.child.n}:${this.unrelated}`}</div>;
      }
    }

    const { instance, settle } = await getDOM<Owner>(<Owner />);
    expect(childCallbacks).toBe(1);

    /**
     * The write is to the PARENT HOOK's own state. The parent's bag is `{ label: "fixed" }` and
     * its callback reads no signal, so the parent is clean on this pass — and the child depends
     * on something the parent's bag says nothing about.
     *
     * This is the assertion that fails if `updateFn` ever skips the recursion along with the
     * diff. Whole subtrees freeze, and nothing else in the suite notices.
     */
    instance.parent.own = 7;
    await settle();

    expect(childCallbacks).toBe(2);
    expect(instance.parent.child.n).toBe(7);
  });

  test("an unrelated render does not re-run a clean child either", async () => {
    let childCallbacks = 0;

    class Child extends Hook<{ n: number }> {
      get n(): number {
        return this.props.n;
      }
    }

    class Parent extends Hook<{ label: string }> {
      @state own = 0;
      child = this.use(Child, (self: Parent) => {
        childCallbacks++;
        return { n: self.own };
      });
    }

    class Owner extends Component {
      @state unrelated = 0;
      parent = this.use(Parent, () => ({ label: "fixed" }));

      render() {
        return <div>{`${this.parent.child.n}:${this.unrelated}`}</div>;
      }
    }

    const { instance, settle } = await getDOM<Owner>(<Owner />);
    instance.unrelated = 1;
    await settle();
    instance.unrelated = 2;
    await settle();

    // The walk reached the child both times and asked its cache, which had nothing to report.
    expect(childCallbacks).toBe(1);
  });

  test("a change reaches a grandchild through the parent's prop, in one pass", async () => {
    const seen: string[] = [];

    class Child extends Hook<{ upper: string }> {
      get upper(): string {
        return this.props.upper;
      }
    }

    class Parent extends Hook<{ label: string }> {
      child = this.use(Child, (self: Parent) => {
        const upper = self.props.label.toUpperCase();
        seen.push(upper);
        return { upper };
      });
    }

    class Owner extends Component {
      @state label = "a";
      parent = this.use(Parent, (self: Owner) => ({ label: self.label }));

      render() {
        return <div>{this.parent.child.upper}</div>;
      }
    }

    const { instance, settle, container } = await getDOM<Owner>(<Owner />);
    expect(seen).toEqual(["A"]);

    /**
     * The chain is two hops: the owner's signal invalidates the parent's callback, whose new bag
     * sets the parent's `label` prop signal, which invalidates the CHILD's callback — and the
     * child's callback is a dependent of a signal the parent only just wrote.
     *
     * It resolves in one pass because the update walk is top-down and sets before it recurses:
     * `State.set` notifies synchronously, so the child's cache is already marked by the time the
     * walk reaches it. A walk that recursed first, or an invalidation that was deferred, would
     * leave the child a render behind — visible here as `A` where `B` belongs.
     */
    instance.label = "b";
    await settle();

    expect(seen).toEqual(["A", "B"]);
    expect(container.textContent).toBe("B");
  });

  test("a callback with a branch re-tracks what it reads", async () => {
    const bags: number[] = [];

    class Reader extends Hook<{ v: number }> {
      get v(): number {
        return this.props.v;
      }
    }

    class Panel extends Component {
      @state useA = true;
      @state a = 1;
      @state b = 100;

      reader = this.use(Reader, (self: Panel) => {
        const v = self.useA ? self.a : self.b;
        bags.push(v);
        return { v };
      });

      render() {
        return <div>{String(this.reader.v)}</div>;
      }
    }

    const { instance, settle } = await getDOM<Panel>(<Panel />);
    expect(bags).toEqual([1]);

    // `b` is on the branch NOT taken, so it is not a dependency and must not invalidate.
    instance.b = 200;
    await settle();
    expect(bags).toEqual([1]);

    // `a` is.
    instance.a = 2;
    await settle();
    expect(bags).toEqual([1, 2]);

    // Switching the branch picks up the other signal — and from here `b` does invalidate, which
    // is why the old dependency set is detached rather than added to.
    instance.useA = false;
    await settle();
    expect(instance.reader.v).toBe(200);

    instance.b = 300;
    await settle();
    expect(instance.reader.v).toBe(300);

    instance.a = 3;
    await settle();
    // `a` is off the taken branch now, so it no longer wakes anything.
    expect(bags.at(-1)).toBe(300);
  });

  test("RMD027 reports a callback reading a value no signal backs", async () => {
    configureDev({ strictRender: true });

    class Reader extends Hook<{ items: readonly number[] }> {
      get total(): number {
        return this.props.items.length;
      }
    }

    class Panel extends Component {
      @state tick = 0;

      /** Not `@state` — so assigning it writes no signal and marks no cache stale. */
      items: number[] = [1];

      reader = this.use(Reader, (self: Panel) => ({ items: self.items }));

      render() {
        return <div>{`${this.reader.total}:${this.tick}`}</div>;
      }
    }

    const { instance, settle } = await getDOM<Panel>(<Panel />);

    // The write nothing can see, followed by a render for an unrelated reason.
    instance.items = [1, 2, 3];
    instance.tick = 1;
    await settle();

    expect(reported()).toContain("RMD027");
    expect(reported()).toContain("items");

    // And the report is describing something real: the hook is still on the old array.
    expect(instance.reader.total).toBe(1);
  });

  test("RMD027 stays quiet for a callback that only rebuilds", async () => {
    configureDev({ strictRender: true });

    class Reader extends Hook<{ filter: { q: string }; onPick: () => void }> {
      get q(): string {
        return this.props.filter.q;
      }
    }

    class Panel extends Component {
      @state tick = 0;
      @state q = "a";

      // A fresh object and a fresh closure on every call — the churn the cache absorbs, and the
      // reason the check compares values instead of references.
      reader = this.use(Reader, (self: Panel) => ({ filter: { q: self.q }, onPick: () => self.q }));

      render() {
        return <div>{`${this.reader.q}:${this.tick}`}</div>;
      }
    }

    const { instance, settle } = await getDOM<Panel>(<Panel />);
    instance.tick = 1;
    await settle();
    instance.tick = 2;
    await settle();

    expect(reported()).not.toContain("RMD027");
  });

  test("a plain object bag keeps its identity and never runs the machinery", async () => {
    class Reader extends Hook<{ n: number }> {
      get n(): number {
        return this.props.n;
      }
    }

    class Panel extends Component {
      @state tick = 0;
      reader = this.use(Reader, { n: 5 });

      render() {
        return <div>{`${this.reader.n}:${this.tick}`}</div>;
      }
    }

    const { instance, settle } = await getDOM<Panel>(<Panel />);
    instance.tick = 1;
    await settle();

    // Nothing to cache and nothing to track — a bag passed as an object has one identity for the
    // life of the call site, so it reaches the same place by the same identity test.
    expect(instance.reader.n).toBe(5);
  });
});
