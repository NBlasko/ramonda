import { describe, expect, test } from "vitest";
import { Component } from "../base/Component";
import type { RamondaNode } from "../types/vdom";
import { created, state } from "../base/decorators";
import { getDOM } from "../test/setup";

/**
 * A conditional child that renders NOTHING must not move its siblings' DOM nodes.
 *
 * `filterVirtualChild` drops `null`, `undefined` and booleans, and none of them leaves a node
 * behind, so a node's POSITION among its siblings moves whenever a conditional appears or
 * disappears — while the piece of JSX that produced it did not move at all. Matching by position
 * then hands a child the node its neighbour was using.
 *
 * It never looked broken: attributes and text are patched either way, so the page reads
 * correctly while focus, scroll position, uncontrolled input state and element identity have all
 * moved to a different node. It was found through `@ramonda/form`'s array rows, where three
 * `<fieldset>` siblings after one `{cond ? … : null}` rotated by one on every re-render.
 *
 * `{cond && <x/>}` is the reason this matters as much as it does: it is how conditionals are
 * usually written, and it yields `false`, not `null`.
 *
 * The answer is `SLOT_SYM`: each node records the JSX child slot it was built for, holes
 * counted, and an unkeyed child claims the node carrying its own slot rather than whatever sits
 * at its position. Position is still the first guess, and still right on the renders where no
 * conditional changed.
 */
describe("a child that renders nothing", () => {
  const holes = [
    ["{cond && <x/>} yields false", false],
    ["{maybe} yields undefined", undefined],
    ["{cond ? … : null} yields null", null],
  ] as const;

  for (const [label, hole] of holes) {
    test(`${label} — the siblings after it keep their nodes`, async () => {
      class Page extends Component {
        @state tick = 0;
        render() {
          return (
            <div>
              {hole}
              <p id="a">A{this.tick}</p>
              <p id="b">B{this.tick}</p>
            </div>
          );
        }
      }

      const app = await getDOM<Page>(<Page />);
      const before = Array.from(app.container.querySelectorAll("p"));
      expect(before).toHaveLength(2);

      app.instance.tick = 1;
      await app.settle();

      const after = Array.from(app.container.querySelectorAll("p"));
      // The same two nodes, in the same order — not swapped, not rebuilt.
      expect(after).toEqual(before);
      expect(after[0]?.textContent).toBe("A1");
      expect(after[1]?.textContent).toBe("B1");
    });
  }

  test("several holes in a row shift nothing either", async () => {
    class Page extends Component {
      @state tick = 0;
      render() {
        return (
          <div>
            {null}
            {false}
            <p id="a">A{this.tick}</p>
            {undefined}
            <p id="b">B{this.tick}</p>
            {null}
            <p id="c">C{this.tick}</p>
          </div>
        );
      }
    }

    const app = await getDOM<Page>(<Page />);
    const before = Array.from(app.container.querySelectorAll("p"));
    expect(before).toHaveLength(3);

    app.instance.tick = 1;
    await app.settle();

    expect(Array.from(app.container.querySelectorAll("p"))).toEqual(before);
  });

  /**
   * Not the same fault, and not one to fix here.
   *
   * When the hole count CHANGES the child list genuinely changes length, and unkeyed children
   * are matched by position — so the siblings after the new node take each other's places.
   * Any diff matching unkeyed children by position does the same, and the answer is `key`.
   *
   * What the fix above guarantees is the other case, which is not a trade-off at all: a hole
   * whose presence does not change between two renders must cost nothing.
   */
  test("a hole that APPEARS leaves its unkeyed siblings alone", async () => {
    class Bare extends Component {
      @state warn = false;
      render() {
        return (
          <div>
            {this.warn ? <em id="w">careful</em> : null}
            <p id="a">A</p>
            <p id="b">B</p>
          </div>
        );
      }
    }

    const app = await getDOM<Bare>(<Bare />);
    const before = Array.from(app.container.querySelectorAll("p"));

    app.instance.warn = true;
    await app.settle();

    expect(app.container.querySelector("#w")?.textContent).toBe("careful");
    // Both keep the node they had. Before slots, these two swapped: each `<p>` matched the
    // position its neighbour had moved into, and `areSimilarNodes` had no reason to object.
    expect(Array.from(app.container.querySelectorAll("p"))).toEqual(before);
  });

  test("and `key` is what holds identity across it", async () => {
    class Keyed extends Component {
      @state warn = false;
      render() {
        return (
          <div>
            {this.warn ? <em id="w">careful</em> : null}
            <p id="a" key="a">
              A
            </p>
            <p id="b" key="b">
              B
            </p>
          </div>
        );
      }
    }

    const app = await getDOM<Keyed>(<Keyed />);
    const before = Array.from(app.container.querySelectorAll("p"));

    app.instance.warn = true;
    await app.settle();

    expect(app.container.querySelector("#w")?.textContent).toBe("careful");
    expect(Array.from(app.container.querySelectorAll("p"))).toEqual(before);
  });

  /* ---------------------------------------------------------------- *
   * The case position alone could never answer: a hole in the MIDDLE.
   * ---------------------------------------------------------------- */

  describe("a hole among same-tag siblings", () => {
    class Middle extends Component {
      @state show = true;
      render() {
        return (
          <div>
            <p id="a">A</p>
            {this.show && <p id="x">X</p>}
            <p id="b">B</p>
          </div>
        );
      }
    }

    test("the sibling BELOW it keeps its own node when the hole opens", async () => {
      const app = await getDOM<Middle>(<Middle />);
      const [a, , b] = Array.from(app.container.querySelectorAll("p"));

      app.instance.show = false;
      await app.settle();

      const after = Array.from(app.container.querySelectorAll("p"));
      // Not `[a, x]` with B's text patched onto X's node — which is what shape matching did,
      // and what nothing in the diff could tell apart from a legitimate move.
      expect(after).toEqual([a, b]);
      expect(after[1]?.textContent).toBe("B");
    });

    test("and again when the hole closes", async () => {
      const app = await getDOM<Middle>(<Middle />);
      app.instance.show = false;
      await app.settle();

      const [a, b] = Array.from(app.container.querySelectorAll("p"));

      app.instance.show = true;
      await app.settle();

      const after = Array.from(app.container.querySelectorAll("p"));
      expect(after).toHaveLength(3);
      expect(after[0]).toBe(a);
      expect(after[2]).toBe(b);
      // The one in the middle is the only new node.
      expect(after[1]).not.toBe(a);
      expect(after[1]).not.toBe(b);
      expect(after.map((el) => el.textContent)).toEqual(["A", "X", "B"]);
    });

    test("state living on the node survives the toggle", async () => {
      // The reason any of this matters. An uncontrolled input's value is not in the vnode, so
      // patching attributes onto the wrong node loses it silently.
      class Form extends Component {
        @state show = true;
        render() {
          return (
            <div>
              <input id="one" />
              {this.show && <input id="two" />}
              <input id="three" />
            </div>
          );
        }
      }

      const app = await getDOM<Form>(<Form />);
      const third = app.container.querySelector<HTMLInputElement>("#three");
      third!.value = "typed by the user";

      app.instance.show = false;
      await app.settle();

      expect(app.container.querySelector<HTMLInputElement>("#three")?.value).toBe("typed by the user");
    });

    test("an optional sibling APPENDED at the end still costs nothing", async () => {
      class Page extends Component {
        @state second = false;
        render() {
          return (
            <div>
              <p>A</p>
              {this.second ? <p>B</p> : null}
            </div>
          );
        }
      }

      const app = await getDOM<Page>(<Page />);
      const first = app.container.querySelector("p");

      app.instance.second = true;
      await app.settle();

      expect(app.container.querySelector("p")).toBe(first);
      expect(app.container.querySelectorAll("p")).toHaveLength(2);
    });

    test("two holes toggling in different places still line up", async () => {
      class Page extends Component {
        @state top = true;
        @state middle = true;
        render() {
          return (
            <div>
              {this.top && <p>T</p>}
              <p id="a">A</p>
              {this.middle && <p>M</p>}
              <p id="b">B</p>
            </div>
          );
        }
      }

      const app = await getDOM<Page>(<Page />);
      const a = app.container.querySelector("#a");
      const b = app.container.querySelector("#b");

      app.instance.top = false;
      app.instance.middle = false;
      await app.settle();

      expect(app.container.querySelector("#a")).toBe(a);
      expect(app.container.querySelector("#b")).toBe(b);
      expect(Array.from(app.container.querySelectorAll("p")).map((el) => el.textContent)).toEqual(["A", "B"]);
    });

    test("a list that empties holds its place", async () => {
      // `normalizeChildren` used to drop an empty array outright, which renumbered every
      // sibling after it — the same failure by another route.
      class Page extends Component {
        @state items: string[] = ["x"];
        render() {
          return (
            <div>
              <p id="a">A</p>
              {this.items.map((item) => (
                <p key={item}>{item}</p>
              ))}
              <p id="b">B</p>
            </div>
          );
        }
      }

      const app = await getDOM<Page>(<Page />);
      const a = app.container.querySelector("#a");
      const b = app.container.querySelector("#b");

      app.instance.items = [];
      await app.settle();

      expect(app.container.querySelector("#a")).toBe(a);
      expect(app.container.querySelector("#b")).toBe(b);
      expect(app.container.querySelectorAll("p")).toHaveLength(2);
    });

    test("a hole INSIDE a mapped list does not disturb the rows", async () => {
      // The region path shares `claimOrMount`, so it is the same rule one level down.
      class Page extends Component {
        @state badge = true;
        render() {
          return (
            <ul>
              {["one", "two"].map((item) => (
                <li key={item}>
                  <span className="label">{item}</span>
                  {this.badge && <span className="badge">!</span>}
                  <span className="tail">end</span>
                </li>
              ))}
            </ul>
          );
        }
      }

      const app = await getDOM<Page>(<Page />);
      const tails = Array.from(app.container.querySelectorAll(".tail"));

      app.instance.badge = false;
      await app.settle();

      expect(Array.from(app.container.querySelectorAll(".tail"))).toEqual(tails);
      expect(app.container.querySelectorAll(".badge")).toHaveLength(0);
    });

    test("a keyed child standing between unkeyed ones does not hide them from each other", async () => {
      // A keyed node carries no slot — nothing asks a keyed child where it sits, and stamping
      // them cost a write per row on every reorder of a keyed list. The search therefore has
      // to STEP OVER an unstamped node instead of stopping at it: `#b` sits past `#k`, and if
      // the walk stopped there it would conclude no node was ever built for its slot and mount
      // a fresh one, losing everything the old node carried.
      class Page extends Component {
        @state show = true;
        render() {
          return (
            <div>
              {this.show && <p id="x">X</p>}
              <p id="a">A</p>
              <p key="k" id="k">
                K
              </p>
              <p id="b">B</p>
            </div>
          );
        }
      }

      const app = await getDOM<Page>(<Page />);
      const a = app.container.querySelector("#a");
      const k = app.container.querySelector("#k");
      const b = app.container.querySelector("#b");

      app.instance.show = false;
      await app.settle();

      expect(app.container.querySelector("#a")).toBe(a);
      expect(app.container.querySelector("#k")).toBe(k);
      expect(app.container.querySelector("#b")).toBe(b);
      expect(Array.from(app.container.querySelectorAll("p")).map((el) => el.textContent)).toEqual(["A", "K", "B"]);

      // And back, so a slot written while the hole was open is read while it is shut.
      app.instance.show = true;
      await app.settle();

      expect(app.container.querySelector("#a")).toBe(a);
      expect(app.container.querySelector("#k")).toBe(k);
      expect(app.container.querySelector("#b")).toBe(b);
      expect(Array.from(app.container.querySelectorAll("p")).map((el) => el.textContent)).toEqual(["X", "A", "K", "B"]);
    });

    test("the same, starting with the conditional ABSENT", async () => {
      class Page extends Component {
        @state show = false;
        render() {
          return (
            <div>
              {this.show && <p id="x">X</p>}
              <p id="a">A</p>
              <p key="k" id="k">
                K
              </p>
              <p id="b">B</p>
            </div>
          );
        }
      }

      const app = await getDOM<Page>(<Page />);
      const a = app.container.querySelector("#a");
      const k = app.container.querySelector("#k");
      const b = app.container.querySelector("#b");

      app.instance.show = true;
      await app.settle();

      expect(app.container.querySelector("#a")).toBe(a);
      expect(app.container.querySelector("#k")).toBe(k);
      expect(app.container.querySelector("#b")).toBe(b);
      expect(Array.from(app.container.querySelectorAll("p")).map((el) => el.textContent)).toEqual(["X", "A", "K", "B"]);
    });

    /* -------------------------------------------------------------- *
     * The full matrix: where the conditional sits, and which way it goes.
     *
     * Starting from ABSENT is not the same code path as starting from present. The first
     * render stamps whatever it mounts, so with the conditional off, the siblings are
     * stamped with the slots they have WITH the hole — and the node for the hole's own slot
     * has never existed. Turning it on then asks for a slot no node carries, which has to
     * mount rather than borrow, while its siblings keep what they had.
     * -------------------------------------------------------------- */

    const places = ["start", "middle", "end"] as const;

    for (const place of places) {
      class Page extends Component {
        @state show: boolean;
        constructor(...args: ConstructorParameters<typeof Component>) {
          super(...args);
          this.show = (this.props as { initial?: boolean }).initial ?? true;
        }
        render() {
          const flash = this.show ? <p id="x">X</p> : null;
          return (
            <div>
              {place === "start" ? flash : null}
              <p id="a">A</p>
              {place === "middle" ? flash : null}
              <p id="b">B</p>
              {place === "end" ? flash : null}
            </div>
          );
        }
      }

      test(`a conditional at the ${place} — present, then hidden`, async () => {
        const app = await getDOM<Page>(<Page initial={true} />);
        const a = app.container.querySelector("#a");
        const b = app.container.querySelector("#b");
        expect(app.container.querySelectorAll("p")).toHaveLength(3);

        app.instance.show = false;
        await app.settle();

        expect(app.container.querySelector("#a")).toBe(a);
        expect(app.container.querySelector("#b")).toBe(b);
        expect(app.container.querySelector("#x")).toBeNull();
        expect(Array.from(app.container.querySelectorAll("p")).map((el) => el.textContent)).toEqual(["A", "B"]);
      });

      test(`a conditional at the ${place} — absent, then shown`, async () => {
        const app = await getDOM<Page>(<Page initial={false} />);
        const a = app.container.querySelector("#a");
        const b = app.container.querySelector("#b");
        expect(app.container.querySelectorAll("p")).toHaveLength(2);

        app.instance.show = true;
        await app.settle();

        // The two that were already there keep their nodes; only X is new.
        expect(app.container.querySelector("#a")).toBe(a);
        expect(app.container.querySelector("#b")).toBe(b);
        const x = app.container.querySelector("#x");
        expect(x).not.toBe(a);
        expect(x).not.toBe(b);

        const expected = place === "start" ? ["X", "A", "B"] : place === "middle" ? ["A", "X", "B"] : ["A", "B", "X"];
        expect(Array.from(app.container.querySelectorAll("p")).map((el) => el.textContent)).toEqual(expected);
      });

      test(`a conditional at the ${place} — off, on, off again`, async () => {
        // Three renders, so a slot written by the second is read by the third.
        const app = await getDOM<Page>(<Page initial={false} />);
        const a = app.container.querySelector("#a");
        const b = app.container.querySelector("#b");

        app.instance.show = true;
        await app.settle();
        const x = app.container.querySelector("#x");

        app.instance.show = false;
        await app.settle();

        expect(app.container.querySelector("#a")).toBe(a);
        expect(app.container.querySelector("#b")).toBe(b);
        expect(app.container.contains(x!)).toBe(false);
        expect(Array.from(app.container.querySelectorAll("p")).map((el) => el.textContent)).toEqual(["A", "B"]);
      });
    }

    /* -------------------------------------------------------------- *
     * Components, where the stake is highest.
     *
     * An element that loses its node loses focus and scroll. A COMPONENT that loses its node
     * loses its instance: `@created` runs again, `@state` goes back to its initial value, and
     * everything the user did to it is gone. The tests above all use intrinsic elements, so
     * these say it about the case that actually costs something.
     * -------------------------------------------------------------- */

    test("a conditional COMPONENT between same-component siblings keeps its neighbours' instances", async () => {
      const built: Row[] = [];

      class Row extends Component<{ label: string }> {
        @state seen = 0;
        @created init() {
          built.push(this);
        }
        render(): RamondaNode {
          return (
            <p className="row">
              {this.props.label}:{this.seen}
            </p>
          );
        }
      }

      class Page extends Component {
        @state show = true;
        render(): RamondaNode {
          return (
            <div>
              <Row label="a" />
              {this.show && <Row label="x" />}
              <Row label="b" />
            </div>
          );
        }
      }

      const app = await getDOM<Page>(<Page />);
      expect(built).toHaveLength(3);
      const [a, , b] = built;
      const before = Array.from(app.container.querySelectorAll("p.row"));

      // Put something on the instances that only survives if the instances do.
      a!.seen = 1;
      b!.seen = 2;
      await app.settle();
      expect(before.map((el) => el.textContent)).toEqual(["a:1", "x:0", "b:2"]);

      app.instance.show = false;
      await app.settle();

      // Nothing was rebuilt: `@created` did not run again for either survivor.
      expect(built).toHaveLength(3);

      const after = Array.from(app.container.querySelectorAll("p.row"));
      expect(after).toHaveLength(2);
      // The same two elements, and each still carrying the state its own instance holds.
      expect(after).toEqual([before[0], before[2]]);
      expect(after.map((el) => el.textContent)).toEqual(["a:1", "b:2"]);
    });

    test("and the same when the conditional component was ABSENT to begin with", async () => {
      const createdLabels: string[] = [];

      class Row extends Component<{ label: string }> {
        @created init() {
          createdLabels.push(this.props.label);
        }
        render(): RamondaNode {
          return <p className="row">{this.props.label}</p>;
        }
      }

      class Page extends Component {
        @state show = false;
        render(): RamondaNode {
          return (
            <div>
              <Row label="a" />
              {this.show && <Row label="x" />}
              <Row label="b" />
            </div>
          );
        }
      }

      const app = await getDOM<Page>(<Page />);
      expect(createdLabels).toEqual(["a", "b"]);
      const before = Array.from(app.container.querySelectorAll("p.row"));

      app.instance.show = true;
      await app.settle();

      // Only the new one is built; `a` and `b` are never touched.
      expect(createdLabels).toEqual(["a", "b", "x"]);
      const after = Array.from(app.container.querySelectorAll("p.row"));
      expect(after[0]).toBe(before[0]);
      expect(after[2]).toBe(before[1]);
      expect(after.map((el) => el.textContent)).toEqual(["a", "x", "b"]);
    });

    test("a conditional among `{this.props.children}` leaves the siblings alone", async () => {
      // Children arrive as the parent's array, one level removed from the JSX that wrote them.
      const createdLabels: string[] = [];

      class Row extends Component<{ label: string }> {
        @created init() {
          createdLabels.push(this.props.label);
        }
        render(): RamondaNode {
          return <p className="row">{this.props.label}</p>;
        }
      }

      class Panel extends Component<{ children?: RamondaNode }> {
        render(): RamondaNode {
          return <section>{this.props.children}</section>;
        }
      }

      class Page extends Component {
        @state show = true;
        render(): RamondaNode {
          return (
            <Panel>
              <Row label="a" />
              {this.show && <Row label="x" />}
              <Row label="b" />
            </Panel>
          );
        }
      }

      const app = await getDOM<Page>(<Page />);
      expect(createdLabels).toEqual(["a", "x", "b"]);
      const before = Array.from(app.container.querySelectorAll("p.row"));

      app.instance.show = false;
      await app.settle();

      expect(createdLabels).toEqual(["a", "x", "b"]);
      const after = Array.from(app.container.querySelectorAll("p.row"));
      expect(after).toEqual([before[0], before[2]]);
      expect(after.map((el) => el.textContent)).toEqual(["a", "b"]);
    });

    test("keyed siblings are unaffected — a key still outranks the slot", async () => {
      // A key is an identity the developer asserted, so a keyed child is allowed to move
      // between slots. This reorders while a hole opens, which the slot must not veto.
      class Page extends Component {
        @state warn = false;
        @state order = ["a", "b"];
        render() {
          return (
            <div>
              {this.warn ? <em>careful</em> : null}
              {this.order.map((id) => (
                <p key={id} id={id}>
                  {id}
                </p>
              ))}
            </div>
          );
        }
      }

      const app = await getDOM<Page>(<Page />);
      const a = app.container.querySelector("#a");
      const b = app.container.querySelector("#b");

      app.instance.warn = true;
      app.instance.order = ["b", "a"];
      await app.settle();

      const after = Array.from(app.container.querySelectorAll("p"));
      expect(after).toEqual([b, a]);
    });
  });
});
