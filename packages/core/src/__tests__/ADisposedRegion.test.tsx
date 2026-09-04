import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { Component, list, state } from "../index";
import { Portal } from "../base/Portal";
import { ChildrenRegion, anchorId } from "../core/childrenRegion";
import { State } from "../reactivity/State";
import { getDOM } from "../test/setup";
import { resetDiagnostics } from "../debug/diagnostics";

/**
 * What a children region does once there is nothing left for it to do.
 *
 * Twelve branches of `core/childrenRegion.ts` had never been taken by either run, and reading them
 * together says why they belong in one file: nine are the `this.disposed` early return on each
 * method, plus the two input guards on `anchorId` and the "nothing to unmount" case. They are the
 * promise that a torn-down region is INERT — and nothing had asked for it, precisely because no
 * ordinary path calls a method after `dispose()`. That is what makes them unhit and what makes a
 * direct test the honest instrument: the guards exist for the arrangement the framework is careful
 * never to produce, and the day it produces one they are what stands between a stale record and a
 * DOM that no longer matches it.
 *
 * **Four of the twelve are still unhit, and each has a reason worth writing down.** `invalidate`'s
 * `!owner` needs a region built with none, and the only constructor call passes a hook's owner, which
 * a hook always has. The guard inside its post-commit callback needs a region disposed while its
 * owner lives, and `Portal` disposes only from `@destroyed` — so a region never outlives its owner by
 * a tick, and the drain skips a destroyed component's callbacks anyway (`core/commit.ts:143`). The
 * other two are the hydration tail scan's nesting count, which needs a server block holding another
 * block where this render wants fewer children: reachable, and not built here.
 *
 * `ChildrenRegion` is exported and takes `(owner: MaybeComponent, name)`, so a test can drive one
 * without a component at all — measured, a bare region reconciles `"hello"` into
 * `<!--r1-->hello<!--/r1-->` and `dispose()` empties the parent. The one thing that path cannot reach
 * is `invalidate`, whose only caller is the list engine's `reBuild`; those cases go through a real
 * `Portal`, which is the single place the framework constructs one (`base/Portal.ts:136`).
 */
let target: HTMLElement;

function host(): HTMLElement {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  return parent;
}

beforeEach(() => {
  resetDiagnostics();
  target = document.createElement("ul");
  document.body.appendChild(target);
});

afterEach(() => {
  target.remove();
});

describe("an anchor's id", () => {
  test("is read from an opening comment and from its closing one", () => {
    expect(anchorId(document.createComment("r7"))).toBe("r7");
    expect(anchorId(document.createComment("/r7"))).toBe("r7");
  });

  test("is nothing for a comment that only looks like one", () => {
    // The guard the file's own comment was written for: a shell is entitled to its own comments, and
    // pairing "the next close anchor" swallowed a `<meta>` into a portal's markup once.
    expect(anchorId(document.createComment("hello"))).toBeUndefined();
    expect(anchorId(document.createComment("r"))).toBeUndefined();
    expect(anchorId(document.createComment("/r"))).toBeUndefined();
    expect(anchorId(document.createComment("rr9"))).toBeUndefined();
  });

  test("is nothing for a node that is not a comment at all", () => {
    expect(anchorId(document.createElement("div"))).toBeUndefined();
    expect(anchorId(document.createTextNode("r7"))).toBeUndefined();
  });
});

describe("a region after dispose()", () => {
  test("reconciles into its parent, and dispose() takes everything back", () => {
    const parent = host();
    const region = new ChildrenRegion(undefined, "test");

    region.reconcile("hello", parent);
    // Structurally, because the id is minted per region and changes with the order tests run in.
    expect(parent.childNodes).toHaveLength(3);
    expect(parent.childNodes[1]?.textContent).toBe("hello");
    expect(anchorId(parent.firstChild!)).toBe(anchorId(parent.lastChild!));

    region.dispose();
    expect(parent.innerHTML).toBe("");
  });

  test("does nothing when reconciled again", () => {
    const parent = host();
    const region = new ChildrenRegion(undefined, "test");
    region.reconcile("hello", parent);
    region.dispose();

    region.reconcile("changed", parent);

    expect(parent.innerHTML).toBe("");
  });

  test("does nothing when its host is reported removed", () => {
    const parent = host();
    const region = new ChildrenRegion(undefined, "test");
    region.reconcile("hello", parent);
    region.dispose();

    expect(() => region.hostRemoved()).not.toThrow();
    expect(parent.innerHTML).toBe("");
  });

  test("does nothing when asked to hydrate", () => {
    const parent = host();
    parent.innerHTML = "<!--r9-->x<!--/r9-->";
    const server = parent.innerHTML;
    const region = new ChildrenRegion(undefined, "test");
    region.dispose();

    region.hydrate("x", parent, parent.firstChild as Comment);

    // The server's markup is left exactly as it was: not adopted, not removed, not reported.
    expect(parent.innerHTML).toBe(server);
  });

  // Not falsifiable from outside either, and said rather than dressed up: with the `disposed` check
  // taken out of `dispose()`, this test still passes — a second teardown of an already-empty record
  // removes nothing twice. It pins that calling it again is SAFE, which is what a caller needs.
  test("can be disposed twice without complaint", () => {
    const parent = host();
    const region = new ChildrenRegion(undefined, "test");
    region.reconcile("hello", parent);

    region.dispose();
    expect(() => region.dispose()).not.toThrow();
    expect(parent.innerHTML).toBe("");
  });
});

describe("a region with nothing in it", () => {
  test("still writes its anchors, and hostRemoved has nothing to unmount", () => {
    const parent = host();
    const region = new ChildrenRegion(undefined, "test");

    region.reconcile(null, parent);
    const anchors = parent.innerHTML;
    expect(parent.childNodes).toHaveLength(2);
    expect(anchorId(parent.firstChild!)).toBe(anchorId(parent.lastChild!));

    // The host is going away and takes the anchors with it, so this clears the record and the
    // ownership rather than the DOM — with no children, there is nothing to unmount on the way.
    expect(() => region.hostRemoved()).not.toThrow();
    expect(parent.innerHTML).toBe(anchors);
  });
});

interface Row {
  t: string;
}

/**
 * The refresh a region queues for ITSELF, and the two ways it is asked for one it must not do.
 *
 * `invalidate` is not reached by changing what the portal's props factory read — that re-runs the
 * factory and goes through `reconcile`. Measured: two tests that mutated `@state rows` left all
 * three of its branches unhit. It is reached the way the method's own comment describes — an item
 * reading a signal the FACTORY did not read, so the factory's cache stays clean and only the
 * engine's dirty scope knows anything happened.
 */
describe("a region's own refresh", () => {
  const page = (label: State<string>) => {
    class Page extends Component {
      @state rows: Row[] = [{ t: "x" }];
      portal = this.use(Portal, () => ({
        children: list(this.rows, () => <li>{label.get()}</li>),
        target,
      }));
      render() {
        return <div>owner</div>;
      }
    }
    return Page;
  };

  test("a signal only an ITEM read still refreshes the row", async () => {
    const label = new State("a");
    const Page = page(label);
    const app = await getDOM(<Page />);
    await app.settle();
    expect(target.textContent).toBe("a");

    label.set("b");
    await app.settle();

    expect(target.textContent).toBe("b");
    app.unmount();
  });

  test("two changes before one drain queue a single refresh, and the last one wins", async () => {
    const label = new State("a");
    const Page = page(label);
    const app = await getDOM(<Page />);
    await app.settle();

    // This takes the `refreshQueued` branch, and taking a branch is not the same as proving it:
    // measured with the flag removed, the DOM is identical and the mapper still runs exactly twice,
    // because reconciling with the same descriptor takes the whole-list skip. So the guard saves a
    // queue entry rather than a visible outcome, and what this pins is the outcome — the last write
    // wins, once.
    label.set("c");
    label.set("d");
    await app.settle();

    expect(target.textContent).toBe("d");
    app.unmount();
  });

  test("a change and then a teardown does nothing at all, rather than reconciling a dead record", async () => {
    const label = new State("a");
    const Page = page(label);
    const app = await getDOM(<Page />);
    await app.settle();
    expect(target.querySelectorAll("li")).toHaveLength(1);

    // The refresh is queued and the owner goes away before the queue drains. What makes that a
    // no-op is NOT the region's own guard — measured, that guard stays unhit here: the drain skips a
    // destroyed component's callbacks outright (`core/commit.ts:143`), so the callback never runs.
    // The region's `disposed || parent === undefined` check inside it is a second line for an
    // ordering the framework does not currently produce: `Portal` disposes its region only from
    // `@destroyed`, so a region never outlives its owner by a tick. This test pins the OUTCOME,
    // which is the part a reader depends on.
    label.set("e");
    app.unmount();
    await app.settle();

    expect(target.innerHTML).toBe("");
  });
});
