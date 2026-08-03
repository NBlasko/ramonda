import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { resetDiagnostics } from "../debug/diagnostics";
import { Component } from "../base/Component";
import { state } from "../base/decorators";
import { getDOM } from "../test/setup";

/**
 * A conditional child that renders NOTHING must not move its siblings' DOM nodes.
 *
 * `filterVirtualChild` drops `null`, `undefined` and booleans, and none of them leaves a node
 * behind — so the pool of existing children is shorter than the vnode list by however many holes
 * precede a child. `applyDiffOnChildren` used to hand `claimOrMount` the raw vnode index, so
 * every sibling after a hole looked for itself one slot too far along, missed, and claimed a
 * neighbour by shape instead.
 *
 * It never looked broken: attributes and text are patched either way, so the page reads
 * correctly while focus, scroll position, uncontrolled input state and element identity have all
 * moved to a different node. It was found through `@ramonda/form`'s array rows, where three
 * `<fieldset>` siblings after one `{cond ? … : null}` rotated by one on every re-render.
 *
 * `{cond && <x/>}` is the reason this matters as much as it does: it is how conditionals are
 * usually written, and it yields `false`, not `null`.
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
   * React reconciles the same way for the same reason, and the answer is the same: `key`.
   *
   * What the fix above guarantees is the other case, which is not a trade-off at all: a hole
   * whose presence does not change between two renders must cost nothing.
   */
  test("a hole that APPEARS shifts unkeyed siblings", async () => {
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
    // Documented, not desired.
    expect(Array.from(app.container.querySelectorAll("p"))).toEqual([before[1], before[0]]);
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
   * RMD026 — what the framework says about the case it cannot fix.
   * ---------------------------------------------------------------- */

  describe("RMD026", () => {
    let seen: { codes: string[]; stop: () => void };

    const capture = () => {
      const codes: string[] = [];
      const handler = (event: Event) => {
        const message = ((event as CustomEvent).detail as { message: string }).message;
        const code = /^\[(RMD\d+)\]/.exec(message)?.[1];
        if (code) codes.push(code);
      };
      window.addEventListener("ramonda:dev-log", handler);
      return { codes, stop: () => window.removeEventListener("ramonda:dev-log", handler) };
    };

    beforeEach(() => {
      resetDiagnostics();
      seen = capture();
    });

    afterEach(() => seen.stop());

    test("reports when a hole appears above unkeyed same-tag siblings", async () => {
      class Page extends Component {
        @state warn = false;
        render() {
          return (
            <div>
              {this.warn ? <em>careful</em> : null}
              <p>A</p>
              <p>B</p>
            </div>
          );
        }
      }

      const app = await getDOM<Page>(<Page />);
      expect(seen.codes).not.toContain("RMD026");

      app.instance.warn = true;
      await app.settle();

      expect(seen.codes).toContain("RMD026");
    });

    test("says nothing when the hole is stable", async () => {
      // The case the fix above made correct. Reporting it would be noise about something that no
      // longer happens.
      class Page extends Component {
        @state tick = 0;
        render() {
          return (
            <div>
              {null}
              <p>A{this.tick}</p>
              <p>B{this.tick}</p>
            </div>
          );
        }
      }

      const app = await getDOM<Page>(<Page />);
      app.instance.tick = 1;
      await app.settle();

      expect(seen.codes).not.toContain("RMD026");
    });

    test("says nothing when the siblings are keyed", async () => {
      class Page extends Component {
        @state warn = false;
        render() {
          return (
            <div>
              {this.warn ? <em>careful</em> : null}
              <p key="a">A</p>
              <p key="b">B</p>
            </div>
          );
        }
      }

      const app = await getDOM<Page>(<Page />);
      app.instance.warn = true;
      await app.settle();

      expect(seen.codes).not.toContain("RMD026");
    });

    test("says nothing when there is only one sibling of that tag", async () => {
      // Nothing to be confused with, so the count moving costs nothing.
      class Page extends Component {
        @state warn = false;
        render() {
          return (
            <div>
              {this.warn ? <em>careful</em> : null}
              <p>A</p>
              <span>B</span>
            </div>
          );
        }
      }

      const app = await getDOM<Page>(<Page />);
      app.instance.warn = true;
      await app.settle();

      expect(seen.codes).not.toContain("RMD026");
    });

    test("says nothing when an optional sibling is APPENDED", async () => {
      // The pattern this repo actually uses — a card plus an optional second one, at the end.
      // Nothing can move: the first keeps slot 0 and the new one mounts after it. A check based
      // on the child count changing reported here, which is why it is not the check.
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

      expect(seen.codes).not.toContain("RMD026");
      expect(app.container.querySelector("p")).toBe(first);
      expect(app.container.querySelectorAll("p")).toHaveLength(2);
    });

    test("says nothing on a first mount", async () => {
      class Page extends Component {
        render() {
          return (
            <div>
              <p>A</p>
              <p>B</p>
            </div>
          );
        }
      }

      await getDOM<Page>(<Page />);

      expect(seen.codes).not.toContain("RMD026");
    });
  });
});
