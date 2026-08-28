import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { getDOM, instanceOf } from "../test/setup";
import { Component, state, list } from "../index";

/**
 * A nested array stays ONE child instead of being spliced into its parent's
 * children, so it gets its own key space — the same guarantee `list()` gets from
 * its region, extended to plain arrays.
 *
 * This is the case origin stamping does NOT cover: both arrays are built by the
 * same component, so they have the same origin. Only the structure tells them
 * apart, which is why not flattening matters on its own.
 */

class Item extends Component<{ label: string }> {
  @state hits = 0;
  render() {
    return (
      <li>
        <span>
          {this.props.label}#{this.hits}
        </span>
      </li>
    );
  }
}

const dump = (c: Element) =>
  Array.from(c.querySelectorAll("li"))
    .map((li) => li.textContent)
    .join(" | ");

const mark = (c: Element, i: number, v: number) => {
  const li = c.querySelectorAll("li")[i];
  instanceOf<{ hits: number }>(li).hits = v;
};

describe("a nested array is its own group", () => {
  beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  test("two .map()s side by side keep their own key spaces", async () => {
    class TwoMaps extends Component {
      @state left = ["a", "b"];
      @state right = ["x", "y"];
      render() {
        return (
          <div>
            <ul>
              {this.left.map((l) => (
                <Item key={l} label={l} />
              ))}
              {this.right.map((r) => (
                <Item key={r} label={r} />
              ))}
            </ul>
          </div>
        );
      }
    }

    const app = await getDOM<TwoMaps>(<TwoMaps />);
    await app.settle();
    mark(app.container, 2, 30); // x
    mark(app.container, 3, 40); // y
    await app.settle();
    expect(dump(app.container)).toBe("a#0 | b#0 | x#30 | y#40");

    // Shrink the LEFT list. The right one is untouched and must stay untouched.
    app.instance.left = ["a"];
    await app.settle();
    expect(dump(app.container)).toBe("a#0 | x#30 | y#40");
  });

  test("colliding keys in two different arrays are not a collision", async () => {
    // Same key in both arrays. Before grouping they shared one key index and
    // claimed each other's nodes; now the diff never matches across the boundary.
    class SameKeys extends Component {
      @state tick = 0;
      render() {
        return (
          <div>
            <ul>
              {["1", "2"].map((k) => (
                <Item key={k} label={`L${k}`} />
              ))}
              {["1", "2"].map((k) => (
                <Item key={k} label={`R${k}`} />
              ))}
            </ul>
          </div>
        );
      }
    }

    const app = await getDOM<SameKeys>(<SameKeys />);
    await app.settle();
    expect(dump(app.container)).toBe("L1#0 | L2#0 | R1#0 | R2#0");

    mark(app.container, 2, 30);
    await app.settle();
    app.instance.tick++;
    await app.settle();

    expect(dump(app.container)).toBe("L1#0 | L2#0 | R1#30 | R2#0");
  });
});

describe("regions nest", () => {
  beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  test("a list mixed with plain children inside one array", async () => {
    // Was a documented gap: grouping this would have nested regions, and they
    // did not nest. `reconcileEntries` recurses now, so it is just another level.
    class Mixed extends Component {
      @state rows = [{ t: "a" }, { t: "b" }];
      render() {
        return (
          <div>
            <ul>
              {[
                <Item label="HEAD" />,
                list(this.rows, (r: { t: string }) => <Item label={r.t} />),
                <Item label="FOOT" />,
              ]}
            </ul>
          </div>
        );
      }
    }

    const app = await getDOM<Mixed>(<Mixed />);
    await app.settle();
    expect(dump(app.container)).toBe("HEAD#0 | a#0 | b#0 | FOOT#0");

    mark(app.container, 0, 10);
    mark(app.container, 3, 40);
    await app.settle();

    app.instance.rows = [{ t: "z" }, ...app.instance.rows];
    await app.settle();

    // The chrome inside the array keeps its state even though the list grew
    // between the two halves of it.
    expect(dump(app.container)).toBe("HEAD#10 | z#0 | a#0 | b#0 | FOOT#40");
  });

  test("two mixed arrays with the same key stay apart", async () => {
    // The case that proves regions must nest. With the array spliced instead of
    // grouped, both `key="k"` landed in the parent's key space and a render that
    // changed NOTHING measured eight items instead of six:
    // "L#10 | la#0 | lb#0 | la#0 | lb#0 | R#40 | ra#0 | rb#0".
    class TwoMixed extends Component {
      @state tick = 0;
      render() {
        return (
          <div>
            <ul>
              {[<Item key="k" label="L" />, ["la", "lb"].map((v) => <Item key={v} label={v} />)]}
              {[<Item key="k" label="R" />, ["ra", "rb"].map((v) => <Item key={v} label={v} />)]}
            </ul>
          </div>
        );
      }
    }

    const app = await getDOM<TwoMixed>(<TwoMixed />);
    await app.settle();
    expect(dump(app.container)).toBe("L#0 | la#0 | lb#0 | R#0 | ra#0 | rb#0");

    mark(app.container, 0, 10);
    mark(app.container, 3, 40);
    await app.settle();

    app.instance.tick++;
    await app.settle();
    expect(dump(app.container)).toBe("L#10 | la#0 | lb#0 | R#40 | ra#0 | rb#0");
  });

  test("an array inside an array inside a slot", async () => {
    class Deep extends Component {
      @state outer = ["a", "b"];
      render() {
        return (
          <div>
            <ul>
              <Item label="HEAD" />
              {[this.outer.map((o) => <Item label={o} />)]}
              <Item label="FOOT" />
            </ul>
          </div>
        );
      }
    }

    const app = await getDOM<Deep>(<Deep />);
    await app.settle();
    expect(dump(app.container)).toBe("HEAD#0 | a#0 | b#0 | FOOT#0");

    mark(app.container, 0, 10);
    mark(app.container, 3, 40);
    await app.settle();

    app.instance.outer = ["a", "b", "c"];
    await app.settle();
    expect(dump(app.container)).toBe("HEAD#10 | a#0 | b#0 | c#0 | FOOT#40");
  });
});
