import { describe, expect, test } from "vitest";
import { getDOM, instanceOf } from "../test/setup";
import { renderToString } from "../hydration/ssr";
import { hydrateRoot } from "../hydration/hydrate";
import { Component, list, state } from "../index";

/**
 * A list inside a list's row, and a value only the INNER rows read.
 *
 * Categories, each listing its products, each product priced in `this.currency`. The category
 * callback never reads `currency`; the product callback does. So when the currency changes, the
 * product's scope is invalidated and the category's is not — and the only way the diff reaches a
 * product is by opening the category row it sits in.
 *
 * Right after the first render that happens: the cached outer node carries `clean` flags of `false`,
 * so the diff opens every row. But once a pass has REUSED the category rows — the same objects in a
 * new array, which is what a sort, a refetch or an append produces — the cached node says every row
 * is clean, the diff claims each one without opening it, and every price keeps the old currency.
 * Keyed rows and unkeyed rows alike.
 */

interface Category {
  name: string;
  products: string[];
}

const fruit: Category = { name: "fruit", products: ["apple", "pear"] };
const veg: Category = { name: "veg", products: ["tomato"] };

function shop(keyed: boolean) {
  return class Shop extends Component {
    @state currency = "RSD";
    @state categories: Category[] = [fruit, veg];

    product(p: string) {
      return (
        <li class="product">
          {p} {this.currency}
        </li>
      );
    }
    category(c: Category) {
      const inner = <ul>{list(c.products, this.product)}</ul>;
      return keyed ? <li key={c.name}>{inner}</li> : <li>{inner}</li>;
    }
    render() {
      return <ul>{list(this.categories, this.category)}</ul>;
    }
  };
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));
const prices = (el: Element) => Array.from(el.querySelectorAll(".product"), (li) => li.textContent);

describe.each([
  ["unkeyed", false],
  ["keyed", true],
])("a list inside a row, %s", (_how, keyed) => {
  test("a currency change right after the first render reaches every product", async () => {
    const Shop = shop(keyed);
    using app = await getDOM<InstanceType<typeof Shop>>(<Shop />);
    await app.settle();

    app.instance.currency = "EUR";
    await app.settle();

    expect(prices(app.container)).toEqual(["apple EUR", "pear EUR", "tomato EUR"]);
  });

  test.each([
    ["copied", (c: Category[]) => [...c]],
    ["reversed", (c: Category[]) => [...c].reverse()],
    ["appended to", (c: Category[]) => [...c, { name: "nuts", products: ["walnut"] }]],
  ])("a currency change after the categories were %s reaches every product", async (_what, change) => {
    const Shop = shop(keyed);
    using app = await getDOM<InstanceType<typeof Shop>>(<Shop />);
    await app.settle();

    app.instance.categories = change(app.instance.categories);
    await app.settle();
    const before = prices(app.container);

    app.instance.currency = "EUR";
    await app.settle();

    expect(prices(app.container)).toEqual(before.map((p) => p?.replace("RSD", "EUR")));
  });

  /**
   * Two more places a list can sit in a row: beside other children in an array, and a level deeper.
   * Three levels is the one that makes the climb take more than one step — the product's change has
   * to mark its group's row AND the category's.
   */
  test.each([
    ["beside other children", false],
    ["two levels down", true],
  ])("a list %s, after a copy, reaches every product", async (_where, deep) => {
    class Shop extends Component {
      @state currency = "RSD";
      @state categories: Category[] = [fruit, veg];
      product(p: string) {
        return (
          <li class="product">
            {p} {this.currency}
          </li>
        );
      }
      group(products: string[]) {
        return <ol>{list(products, this.product)}</ol>;
      }
      category(c: Category) {
        const inside = deep ? list([c.products], this.group) : [<b>{c.name}</b>, list(c.products, this.product)];
        return keyed ? <li key={c.name}>{inside}</li> : <li>{inside}</li>;
      }
      render() {
        return <ul>{list(this.categories, this.category)}</ul>;
      }
    }
    using app = await getDOM<Shop>(<Shop />);
    await app.settle();

    app.instance.categories = [...app.instance.categories];
    await app.settle();
    app.instance.currency = "EUR";
    await app.settle();

    expect(prices(app.container)).toEqual(["apple EUR", "pear EUR", "tomato EUR"]);
  });

  /**
   * Hydration builds the lists by a path of its own, and the inner ones have to learn which row they
   * sit in there too: the first pass after it reuses every category row, so a list that did not know
   * its row would never be reached again.
   */
  test("the same, on a page that was served and hydrated", async () => {
    const Shop = shop(keyed);
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = await renderToString(<Shop />);

    hydrateRoot(<Shop />, container);
    await settled();
    const app = instanceOf<InstanceType<typeof Shop>>(container.firstChild);

    app.categories = [...app.categories];
    await settled();
    app.currency = "EUR";
    await settled();

    expect(prices(container)).toEqual(["apple EUR", "pear EUR", "tomato EUR"]);
    container.remove();
  });
});
