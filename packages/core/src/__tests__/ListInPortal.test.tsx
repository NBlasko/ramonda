import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { getDOM } from "../test/setup";
import { Component, Host, list, state } from "../index";
import { Portal } from "../base/Portal";
import { resetDiagnostics } from "../debug/diagnostics";

/**
 * `list()` where a HOOK consumes renderable children, not a `render()` slot.
 *
 * The promise `list()` makes is one thing — minted identity, per-item reactive
 * scopes, the whole-list skip — and it has to hold wherever someone writes the
 * call. Somebody will write
 *
 * ```tsx
 * this.use(Portal, () => ({ children: list({ each, as }), target }))
 * ```
 *
 * because nothing about `list()` says it may only appear in `render()`. A
 * positional fallback that runs the mapper and throws the state away would keep
 * that from crashing while silently dropping identity and per-item scopes, which
 * is worse than the crash: the call still looks like a list.
 *
 * So these tests assert the LIST behaviour, not merely that markup appears —
 * node identity through a reorder, and the mapper not running when nothing
 * changed. Portal is the first consumer; the rule is "wherever a hook consumes
 * renderable children".
 */

interface Row {
  t: string;
}

let target: HTMLElement;
let mapperCalls = 0;

beforeEach(() => {
  resetDiagnostics();
  mapperCalls = 0;
  target = document.createElement("ul");
  target.id = "portal-target";
  document.body.appendChild(target);
});

afterEach(() => {
  target.remove();
});

const rowsIn = (el: Element) =>
  Array.from(el.querySelectorAll("li"))
    .map((li) => li.textContent)
    .join(",");

describe("list() inside a hook's children", () => {
  test("nested in JSX, it renders into the target", async () => {
    // The baseline: wrapped in an element, the list is a child of a vnode that
    // goes through the real diff, so `h` stamps its owner and the <ul> gets its
    // own record. This is the case that must keep working, and the one the
    // direct-child test below is measured against.
    @Host("div")
    class Page extends Component {
      @state rows: Row[] = [{ t: "a" }, { t: "b" }];
      portal = this.use(Portal, () => ({
        children: (
          <ul>
            {list(this.rows, (r: Row) => {
                mapperCalls++;
                return <li>{r.t}</li>;
              })}
          </ul>
        ),
        target,
      }));
      render() {
        return <p>owner</p>;
      }
    }

    const app = await getDOM<Page>(<Page />);
    await app.settle();

    expect(rowsIn(target)).toBe("a,b");
    expect(app.container.querySelector("li")).toBeNull();
  });

  test("as the direct child, it renders into the target", async () => {
    @Host("div")
    class Page extends Component {
      @state rows: Row[] = [{ t: "a" }, { t: "b" }];
      portal = this.use(Portal, () => ({
        children: list(this.rows, (r: Row) => {
            mapperCalls++;
            return <li>{r.t}</li>;
          }),
        target,
      }));
      render() {
        return <p>owner</p>;
      }
    }

    const app = await getDOM<Page>(<Page />);
    await app.settle();

    expect(rowsIn(target)).toBe("a,b");
  });

  test("a reorder MOVES the rows instead of rewriting them", async () => {
    // The claim a positional fallback cannot make. With identity, `b`'s <li> is
    // the same DOM node before and after — it moved. Positionally, the two nodes
    // stay put and their text is rewritten, so the node that reads "b" afterwards
    // is the one that read "a".
    @Host("div")
    class Page extends Component {
      @state rows: Row[] = [{ t: "a" }, { t: "b" }];
      portal = this.use(Portal, () => ({
        children: list(this.rows, (r: Row) => <li>{r.t}</li>),
        target,
      }));
      render() {
        return <p>owner</p>;
      }
    }

    const app = await getDOM<Page>(<Page />);
    await app.settle();

    const [first, second] = Array.from(target.querySelectorAll("li"));
    expect(first.textContent).toBe("a");

    app.instance.rows = [app.instance.rows[1], app.instance.rows[0]];
    await app.settle();

    expect(rowsIn(target)).toBe("b,a");
    const [nowFirst, nowSecond] = Array.from(target.querySelectorAll("li"));
    expect(nowFirst).toBe(second);
    expect(nowSecond).toBe(first);
  });

  test("an unrelated render does not run the mapper", async () => {
    // The whole-list skip, through a hook callback: `each` is the same array and
    // no item's scope was invalidated, so there is nothing for the region to do.
    @Host("div")
    class Page extends Component {
      @state rows: Row[] = [{ t: "a" }, { t: "b" }];
      @state tick = 0;
      portal = this.use(Portal, () => ({
        children: list(this.rows, (r: Row) => {
            mapperCalls++;
            return <li>{r.t}</li>;
          }),
        target,
      }));
      render() {
        return <p>{String(this.tick)}</p>;
      }
    }

    const app = await getDOM<Page>(<Page />);
    await app.settle();
    const firstLi = target.querySelector("li");

    mapperCalls = 0;
    app.instance.tick++;
    await app.settle();

    expect(mapperCalls).toBe(0);
    expect(target.querySelector("li")).toBe(firstLi);
    expect(rowsIn(target)).toBe("a,b");
  });

  test("a signal only the MAPPER reads still updates its row", async () => {
    // The per-item scope, and the case a hook callback makes hard. `children` is
    // rebuilt by a props factory, which subscribes to what IT reads — here, the
    // array. `highlight` is read by the mapper instead, deeper, so the factory
    // never sees it: its cached bag keeps its identity and nothing tells the
    // portal to reconcile. The item's own scope is what noticed, and it has to be
    // able to say so.
    @Host("div")
    class Page extends Component {
      @state rows: Row[] = [{ t: "a" }, { t: "b" }];
      @state highlight = "";
      portal = this.use(Portal, () => ({
        children: list(this.rows, (r: Row) => {
            mapperCalls++;
            // Only row "b" ever READS the signal — the ternary short-circuits
            // for the others, so only its scope subscribes. A test where every
            // mapper evaluates `this.highlight === r.t` would subscribe them all
            // and prove nothing about which row was rebuilt.
            return <li>{r.t === "b" ? this.highlight : ""}</li>;
          }),
        target,
      }));
      render() {
        return <p>owner</p>;
      }
    }

    const app = await getDOM<Page>(<Page />);
    await app.settle();
    const [rowA, rowB] = Array.from(target.querySelectorAll("li"));

    mapperCalls = 0;
    app.instance.highlight = "on";
    await app.settle();

    expect(rowB.textContent).toBe("on");
    // Only the row that read it was rebuilt — the other kept its scope.
    expect(mapperCalls).toBe(1);
    // And nothing was re-created: both rows are the nodes they were. Compared
    // one by one, because `toEqual` on DOM nodes compares them STRUCTURALLY and
    // a rebuilt row would satisfy it.
    const rows = Array.from(target.querySelectorAll("li"));
    expect(rows[0]).toBe(rowA);
    expect(rows[1]).toBe(rowB);
  });

  test("two portals into one target keep their own rows", async () => {
    // Each portal owns a block. Neither may claim the other's nodes — the
    // property the hand-rolled reconcile had to be careful about, and which the
    // region boundary has to keep.
    @Host("div")
    class Page extends Component {
      @state left: Row[] = [{ t: "l1" }, { t: "l2" }];
      @state right: Row[] = [{ t: "r1" }];
      a = this.use(Portal, () => ({
        children: list(this.left, (r: Row) => <li>{r.t}</li>),
        target,
      }));
      b = this.use(Portal, () => ({
        children: list(this.right, (r: Row) => <li>{r.t}</li>),
        target,
      }));
      render() {
        return <p>owner</p>;
      }
    }

    const app = await getDOM<Page>(<Page />);
    await app.settle();

    expect(rowsIn(target)).toBe("l1,l2,r1");

    app.instance.left = [...app.instance.left, { t: "l3" }];
    await app.settle();

    // The new row lands inside the FIRST portal's block, not at the end of the
    // target — which is what tells the two blocks apart.
    expect(rowsIn(target)).toBe("l1,l2,l3,r1");
  });
});
