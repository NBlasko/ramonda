import { describe, expect, test } from "vitest";
import { getDOM } from "../test/setup";
import { Component } from "../base/Component";
import { compute, state } from "../base/decorators";
import { list } from "../base/list";

/**
 * A `list()` whose ARRAY never changes, whose row callback reads a signal that does.
 *
 * The reason to doubt it is written in the engine: an item scope is reused on
 * `existing.item === item && !existing.dirty`, so a stable array means every row is a candidate
 * for reuse and a row that kept a stale value would be silently wrong — the array is the same, so
 * nothing about the list looks like it changed.
 *
 * What makes it work is that the item scope IS a tracker: `buildItem` installs the scope as
 * `trackerContainer.current` around the row callback, so a signal READ inside the callback is
 * recorded in that scope's deps and subscribed with an `onChange` that marks the scope dirty and
 * asks the host to rebuild. The reuse check then fails for exactly the rows that read it.
 *
 * These tests exist because that is a chain of four things, and "it happens to work" and "it is
 * guaranteed" look identical until one of them is planted.
 */
describe("a list row that reads a signal", () => {
  test("the row callback's signal read reaches the DOM, with the array untouched", async () => {
    class Row extends Component<{ item: string; children?: unknown }> {
      render() {
        return (
          <li>
            {this.props.item}:{this.props.children}
          </li>
        );
      }
    }

    class Page extends Component {
      // Never reassigned — the whole point. `readonly` so a future edit cannot quietly make the
      // test pass for the wrong reason.
      readonly rows: readonly string[] = ["a", "b"];
      @state suffix = 1;
      render() {
        return (
          <ul>
            {list(this.rows, (item) => (
              <Row item={item}>{String(this.suffix)}</Row>
            ))}
          </ul>
        );
      }
    }

    const app = await getDOM<Page>(<Page />);
    expect(text(app)).toEqual(["a:1", "b:1"]);

    app.instance.suffix = 2;
    await app.settle();

    // Both rows, because both read it. A stale row would still say ":1".
    expect(text(app)).toEqual(["a:2", "b:2"]);
    // And the array really was the same one throughout.
    expect(app.instance.rows).toEqual(["a", "b"]);
  });

  test("a signal read by only SOME rows moves only those", async () => {
    class Row extends Component<{ item: string; children?: unknown }> {
      render() {
        return (
          <li>
            {this.props.item}:{this.props.children}
          </li>
        );
      }
    }

    class Page extends Component {
      readonly rows: readonly string[] = ["a", "b"];
      @state flag = 1;
      render() {
        return (
          <ul>
            {list(this.rows, (item) => (
              // Only the "a" row reads the signal. The "b" row has no dependency on it, so its
              // scope stays clean and it is reused — which is the optimisation this is checking is
              // not paid for with a stale row somewhere else.
              <Row item={item}>{item === "a" ? String(this.flag) : "-"}</Row>
            ))}
          </ul>
        );
      }
    }

    const app = await getDOM<Page>(<Page />);
    expect(text(app)).toEqual(["a:1", "b:-"]);

    app.instance.flag = 9;
    await app.settle();
    expect(text(app)).toEqual(["a:9", "b:-"]);
  });

  test("a @compute read from the row callback carries the same guarantee", async () => {
    class Row extends Component<{ item: string; children?: unknown }> {
      render() {
        return (
          <li>
            {this.props.item}:{this.props.children}
          </li>
        );
      }
    }

    class Page extends Component {
      readonly rows: readonly string[] = ["a"];
      @state n = 1;
      @compute get doubled() {
        return this.n * 2;
      }
      render() {
        return (
          <ul>
            {list(this.rows, (item) => (
              <Row item={item}>{String(this.doubled)}</Row>
            ))}
          </ul>
        );
      }
    }

    const app = await getDOM<Page>(<Page />);
    expect(text(app)).toEqual(["a:2"]);

    app.instance.n = 5;
    await app.settle();
    // The compute's own deps are re-published to whoever read it, so the row scope is subscribed to
    // `n` rather than to the compute — see the `trackDependency` loop on the compute's hit path.
    expect(text(app)).toEqual(["a:10"]);
  });

  /**
   * The mirror: a signal the callback does NOT read must not wake the rows. Without this the suite
   * would pass just as well if every write rebuilt every row, which is the behaviour the item scope
   * exists to avoid — and the tests above would be proving nothing about the subscription.
   */
  test("a signal the callback never reads leaves the rows alone", async () => {
    let builds = 0;

    class Row extends Component<{ item: string }> {
      render() {
        return <li>{this.props.item}</li>;
      }
    }

    class Page extends Component {
      readonly rows: readonly string[] = ["a", "b"];
      @state unrelated = 1;
      @state shown = "x";

      /**
       * A METHOD, and the form is the condition for this mirror.
       *
       * A fresh closure per render could have captured anything from that render, so the engine
       * rebuilds every row for it rather than serve a stale capture — which would make `builds` climb
       * here for a reason that has nothing to do with subscriptions. A method cannot capture, so what
       * this measures is the item scope, which is the point. See `ListCallbackIdentity.test.tsx`.
       */
      row(item: string) {
        builds++;
        return <Row item={item} />;
      }

      render() {
        return (
          <div>
            <p>{this.shown}</p>
            <ul>{list(this.rows, this.row)}</ul>
          </div>
        );
      }
    }

    const app = await getDOM<Page>(<Page />);
    const afterFirst = builds;
    expect(afterFirst).toBe(2);

    // Writing a field the rows do not read still re-renders the owner, so the list is walked —
    // but each row's scope is clean, so no callback runs again.
    app.instance.unrelated = 2;
    await app.settle();
    expect(builds).toBe(afterFirst);
  });
});

function text(app: { container: HTMLElement }): string[] {
  return Array.from(app.container.querySelectorAll("li")).map((li) => li.textContent ?? "");
}
