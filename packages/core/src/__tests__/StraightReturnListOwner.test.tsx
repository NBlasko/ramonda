import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { getDOM } from "../test/setup";
import { Component, Host, list, state } from "../index";
import { CHILD_RECORD } from "../helpers/constants";

/**
 * The identity a `list()` gets when it is returned STRAIGHT from `render()`.
 *
 * A region is identified by its owner — the component that built it, plus the
 * position it occupies — so a list a component built for itself can never be
 * matched against one handed to it through a prop. `<ul>{list({…})}</ul>` gets
 * that identity in `h.ts`, from the LIVE origin, which is the component's id.
 *
 * `return list({…})` does not go through `h.ts` at all, so the owner is stamped
 * in `generateRenderOutput` instead — but that stamp happens after the block that
 * RESTORES the previous origin, so the id it read was never the component's. The
 * comment beside it said it was. It worked, because what it actually read was 0
 * and 0 is stable and unique per host, so nothing ever disagreed — the two paths
 * simply produced different identities for the same idea, and only one of them
 * was the one described.
 *
 * These tests pin the behaviour that had to hold either way — a straight-returned
 * list keeps its DOM across re-renders, two of them never claim each other's rows
 * — plus the identity itself, so the two paths cannot drift apart again.
 */
describe("a list returned straight from render()", () => {
  beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  test("keeps its rows across a re-render", async () => {
    @Host("ul")
    class L extends Component {
      @state rows = [{ id: 1 }, { id: 2 }];
      @state tick = 0;

      render() {
        return list(this.rows, (r: { id: number }) => <li>{r.id}</li>);
      }
    }

    const app = await getDOM<L>(<L />);
    await app.settle();

    const before = [...app.container.querySelectorAll("li")];
    expect(before.map((li) => li.textContent)).toEqual(["1", "2"]);

    app.instance.tick++;
    await app.settle();

    const after = [...app.container.querySelectorAll("li")];
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
  });

  test("two of them side by side keep their own rows", async () => {
    @Host("ul")
    class L extends Component<{ from: number }> {
      @state tick = 0;

      render() {
        const rows = [{ id: this.props.from }, { id: this.props.from + 1 }];
        return list(rows, (r: { id: number }) => <li>{r.id}</li>);
      }
    }

    @Host("div")
    class App extends Component {
      @state tick = 0;

      render() {
        return (
          <div data-tick={String(this.tick)}>
            <L from={10} />
            <L from={20} />
          </div>
        );
      }
    }

    const app = await getDOM<App>(<App />);
    await app.settle();

    const before = [...app.container.querySelectorAll("li")].map((li) => li.textContent);
    expect(before).toEqual(["10", "11", "20", "21"]);

    app.instance.tick++;
    await app.settle();

    expect([...app.container.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["10", "11", "20", "21"]);
  });

  test("its owner is the component's own id, the same as a wrapped list's", async () => {
    @Host("ul")
    class Straight extends Component {
      render() {
        return list([1], (n: number) => <li>{n}</li>);
      }
    }

    @Host("div")
    class Wrapped extends Component {
      render() {
        return <ul>{list([1], (n: number) => <li>{n}</li>)}</ul>;
      }
    }

    @Host("div")
    class App extends Component {
      render() {
        return (
          <div>
            <Straight />
            <Wrapped />
          </div>
        );
      }
    }

    const app = await getDOM<App>(<App />);
    await app.settle();

    // A record entry is either a DOM node or a ListRegion; the region is the one
    // carrying an owner.
    const ownerOf = (host: Element | null) => {
      const record = (host as unknown as { [CHILD_RECORD]?: { owner?: unknown }[] })?.[CHILD_RECORD];
      const region = record?.find((entry) => entry?.owner !== undefined);
      return String(region?.owner ?? "");
    };

    const straightHost = app.container.querySelector('[data-ramonda="Straight"]');
    const wrappedInner = app.container.querySelector('[data-ramonda="Wrapped"] ul');

    const straightOwner = ownerOf(straightHost);
    const wrappedOwner = ownerOf(wrappedInner);

    // Both are "<the component's id>:g<position>", so the shape is the same and
    // the id is the component's rather than whatever the origin had been reset to.
    expect(straightOwner).toMatch(/^\d+:g0$/);
    expect(wrappedOwner).toMatch(/^\d+:g0$/);
    expect(straightOwner).not.toBe("0:g0");
    // Different components, so different owners — which is the point of the id.
    expect(straightOwner).not.toBe(wrappedOwner);
  });
});
