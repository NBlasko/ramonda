import { describe, expect, test } from "vitest";
import { getDOM } from "../test/setup";
import { Component, compute, list, state } from "../index";
import { createId } from "../helpers/createId";
import { effectLike } from "../test/effectLike";

/**
 * A list row's listener id, and every other listener's, on the same signal.
 *
 * A `State` keeps its listeners in a map keyed by id, so two listeners with one id are one listener:
 * the second `attach` replaces the first. Every listener took its id from `createId()` except a list
 * row, which counted from 1 on a sequence of its own — so once the rows of a page reached the number
 * a `@compute` or an effect had been given, one took the other's place on the signal — whichever
 * attached second. A compute that lost was never told, and served its first value for ever; a row
 * that lost kept its old text while every row around it changed.
 *
 * Which number collides depends on how many ids and rows the page made before, so in an app it came
 * and went. Here it is made certain: each test peeks at the shared counter and renders more rows than
 * that, so under a separate sequence one of them lands on the compute's or the effect's number.
 * Measured with the sequence put back: the compute test fails with all 101 rows showing the old
 * value, and the effect test with exactly one — row 5, the row the effect displaced.
 */

/** More rows than ids handed out so far, so that a row counting from 1 would reach every one of them. */
const rowsPastEveryId = () => Array.from({ length: createId() + 100 }, (_, i) => i);

describe("a row and another listener on one signal", () => {
  test("a @compute every row reads is recomputed when its source changes", async () => {
    const rows = rowsPastEveryId();

    class Page extends Component {
      @state currency = "RSD";
      @compute get price(): string {
        return this.currency;
      }
      row = (n: number) => (
        <i>
          {n} {this.price}
        </i>
      );
      render() {
        return <p>{list(rows, this.row)}</p>;
      }
    }

    using app = await getDOM<Page>(<Page />);
    await app.settle();

    app.instance.currency = "EUR";
    await app.settle();

    const stale = Array.from(app.container.querySelectorAll("i"), (i) => i.textContent).filter(
      (t) => !t?.endsWith("EUR"),
    );
    expect(stale).toEqual([]);
  });

  test("an effect and the rows reading one signal all hear it change", async () => {
    const rows = rowsPastEveryId();
    const seen: string[] = [];

    class Page extends Component {
      @state currency = "RSD";
      @effectLike()
      watch() {
        seen.push(this.currency);
      }
      row = (n: number) => (
        <i>
          {n} {this.currency}
        </i>
      );
      render() {
        return <p>{list(rows, this.row)}</p>;
      }
    }

    using app = await getDOM<Page>(<Page />);
    await app.settle();

    app.instance.currency = "EUR";
    await app.settle();

    expect(seen).toEqual(["RSD", "EUR"]);
    const stale = Array.from(app.container.querySelectorAll("i"), (i) => i.textContent).filter(
      (t) => !t?.endsWith("EUR"),
    );
    expect(stale).toEqual([]);
  });
});
