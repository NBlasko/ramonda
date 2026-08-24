import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { getDOM, findOne, regionOf } from "../test/setup";
import { Component, list, state } from "../index";
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
    class L extends Component {
      @state rows = [{ id: 1 }, { id: 2 }];
      @state tick = 0;

      render() {
        return (
          <ul>
            {list(this.rows, (r: { id: number }) => (
              <li>{r.id}</li>
            ))}
          </ul>
        );
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
    class L extends Component<{ from: number }> {
      @state tick = 0;

      render() {
        const rows = [{ id: this.props.from }, { id: this.props.from + 1 }];
        return (
          <ul>
            {list(rows, (r: { id: number }) => (
              <li>{r.id}</li>
            ))}
          </ul>
        );
      }
    }

    class App extends Component {
      @state tick = 0;

      render() {
        return (
          <div>
            <div data-tick={String(this.tick)}>
              <L from={10} />
              <L from={20} />
            </div>
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
    class Straight extends Component {
      render() {
        // The list IS the output: no element of its own, so its nodes are this component's range.
        return list([1], (n: number) => <li>{n}</li>);
      }
    }

    class Wrapped extends Component {
      render() {
        return (
          <li>
            <ul id="wrapped">
              {list([1], (n: number) => (
                <li>{n}</li>
              ))}
            </ul>
          </li>
        );
      }
    }

    class App extends Component {
      render() {
        return (
          <ul>
            <Straight />
            <Wrapped />
          </ul>
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

    /**
     * Where each list's region hangs, found through the RECORD rather than a marker attribute.
     *
     * `Straight` returns the list itself, so its region is an entry in ITS OWN region — a component
     * owns a range now, and a list returned straight from a render is one entry in that range.
     * `Wrapped` puts it inside a `<ul>`, so the region hangs off that element as it always did.
     */
    const straight = findOne<object>(app.container, "Straight");
    const straightOwner = String(
      ((regionOf(straight)?.entries ?? []) as { owner?: unknown }[]).find((e) => e?.owner !== undefined)?.owner ?? "",
    );
    const wrappedOwner = ownerOf(app.container.querySelector("#wrapped"));

    // Both are "<the component's id>:g<position>", so the shape is the same and
    // the id is the component's rather than whatever the origin had been reset to.
    expect(straightOwner).toMatch(/^\d+:g0$/);
    expect(wrappedOwner).toMatch(/^\d+:g0$/);
    expect(straightOwner).not.toBe("0:g0");
    // Different components, so different owners — which is the point of the id.
    expect(straightOwner).not.toBe(wrappedOwner);
  });
});
