import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { getDOM } from "../test/setup";
import { Component, Host, list, state } from "../index";

/**
 * The whole-list skip: when `each` is the same array reference and no item's
 * scope was invalidated, the engine hands back the IDENTICAL `ListNode` and the
 * diff leaves the region alone — it does not look at a single item.
 *
 * Measured on 10000 items, a re-render triggered by unrelated state went 30ms ->
 * 1.5ms, with zero iterations of the item loop.
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

@Host("div")
class App extends Component {
  @state rows: Row[] = [{ t: "a" }, { t: "b" }, { t: "c" }];
  @state tick = 0;
  render() {
    return (
      <ul data-tick={String(this.tick)}>
        {list({
          each: this.rows,
          render: (r: Row) => {
            mapperCalls++;
            return <li>{r.t}</li>;
          },
        })}
      </ul>
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
});
