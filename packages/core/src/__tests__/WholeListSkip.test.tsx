import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { getDOM } from "../test/setup";
import { Component, list, state } from "../index";
import { CHILD_RECORD } from "../helpers/constants";
import type { ListRegion } from "../types/vdom";

/**
 * The whole-list skip: when `each` is the same array reference and no item's
 * scope was invalidated, the engine hands back the IDENTICAL `ListNode`: no
 * callback runs and no row is rebuilt. The diff still walks the rows, claiming
 * each one without opening it and touching no DOM.
 *
 * Measured on 10000 items, a re-render triggered by unrelated state went 30ms ->
 * 1.5ms, with zero calls to the callback.
 *
 * The assertion is the mapper call count plus DOM node identity, not the
 * ListNode's. `For` exposed a `.nodes` getter so the object could be compared
 * directly; a `list()` descriptor is built fresh per render by design, and its
 * engine lives on the region where a test cannot reach it. Node identity is the
 * stronger claim anyway: it says the region was not merely recognised, but left
 * physically untouched.
 */

interface Row {
  t: string;
}

let mapperCalls = 0;

class App extends Component {
  @state rows: Row[] = [{ t: "a" }, { t: "b" }, { t: "c" }];
  @state tick = 0;
  /**
   * A METHOD, and the form is what the skip now turns on.
   *
   * An inline arrow is a new function every render, and a new function could have closed over anything
   * from that render — so the engine rebuilds every row for it rather than serve a stale capture. A
   * method cannot capture a render's locals, so its reference is stable and the skip applies. See
   * `listEngine.ts`'s `lastBuilder`, and `ListCallbackIdentity.test.tsx` for both halves.
   */
  row(r: Row) {
    mapperCalls++;
    return <li>{r.t}</li>;
  }

  render() {
    return (
      <div>
        <ul data-tick={String(this.tick)}>{list(this.rows, this.row)}</ul>
      </div>
    );
  }
}

const dump = (c: Element) =>
  Array.from(c.querySelectorAll("li"))
    .map((li) => li.textContent)
    .join(",");

describe("whole-list skip", () => {
  beforeEach(() => {
    mapperCalls = 0;
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  test("an unrelated re-render does not run the mapper", async () => {
    const app = await getDOM<App>(<App />);
    await app.settle();
    const firstLi = app.container.querySelector("li");

    mapperCalls = 0;
    app.instance.tick++;
    await app.settle();

    expect(mapperCalls).toBe(0);
    // The rest of the element still updated, so nothing was skipped wrongly.
    expect(app.container.querySelector("ul")!.getAttribute("data-tick")).toBe("1");
    expect(app.container.querySelector("li")).toBe(firstLi);
    expect(dump(app.container)).toBe("a,b,c");
  });

  test("replacing the array runs the mapper and updates the DOM", async () => {
    const app = await getDOM<App>(<App />);
    await app.settle();

    mapperCalls = 0;
    app.instance.rows = [...app.instance.rows, { t: "d" }];
    await app.settle();

    expect(mapperCalls).toBeGreaterThan(0);
    expect(dump(app.container)).toBe("a,b,c,d");
  });

  test("the skip survives several unrelated renders in a row", async () => {
    const app = await getDOM<App>(<App />);
    await app.settle();
    const firstLi = app.container.querySelector("li");

    mapperCalls = 0;
    for (let i = 0; i < 5; i++) {
      app.instance.tick++;
      await app.settle();
    }

    expect(mapperCalls).toBe(0);
    expect(app.container.querySelector("li")).toBe(firstLi);
    expect(dump(app.container)).toBe("a,b,c");
    expect(app.container.querySelector("ul")!.getAttribute("data-tick")).toBe("5");
  });

  /**
   * And the diff does not walk the rows either: the region is kept whole when the engine hands back
   * last pass's node. Counted rather than timed — every read of a row from that node is one row the
   * diff looked at.
   */
  test("an unrelated re-render does not look at a single row", async () => {
    const app = await getDOM<App>(<App />);
    await app.settle();
    app.instance.rows = Array.from({ length: 1000 }, (_, i) => ({ t: String(i) }));
    await app.settle();

    const ul = app.container.querySelector("ul") as unknown as { [CHILD_RECORD]: ListRegion[] };
    const source = ul[CHILD_RECORD][0].source as { vnodes: unknown[] };
    let rowsRead = 0;
    source.vnodes = new Proxy(source.vnodes, {
      get(target, property, receiver) {
        if (typeof property === "string" && /^\d+$/.test(property)) rowsRead++;
        return Reflect.get(target, property, receiver);
      },
    });

    app.instance.tick = 1;
    await app.settle();

    expect(app.container.querySelectorAll("li")).toHaveLength(1000);
    expect(app.container.querySelector("ul")!.getAttribute("data-tick")).toBe("1");
    expect(rowsRead).toBe(0);
  });
});
