import { describe, test, expect } from "vitest";
import { getDOM } from "../test/setup";
import { Component, state, list, memoized } from "../index";
import { __template, __block } from "../jsx-runtime";
import { renderToString } from "../hydration/ssr";
import { hydrateRoot } from "../hydration/hydrate";
import { flushSync } from "../testing";
import { componentAt } from "../core/DiffAndMerge";

/**
 * What the JSX compiler writes for an element tree whose shape never changes, written here by hand: the
 * template once, and per render only the values of its holes. Each shape below is one the compiler emits.
 */

interface Row {
  readonly id: number;
  readonly label: string;
}

/** The js-framework-benchmark row: a class, two text children and two listeners. */
const ROW = __template({
  t: "tr",
  d: [["className", 0]],
  c: [
    { t: "td", a: { class: "col-md-1" }, h: 1 },
    { t: "td", a: { class: "col-md-4" }, c: [{ t: "a", d: [["onclick", 2]], h: 3 }] },
    {
      t: "td",
      a: { class: "col-md-1" },
      c: [{ t: "a", d: [["onclick", 4]], c: [{ t: "span", a: { class: "glyphicon", "aria-hidden": "true" } }] }],
    },
    { t: "td", a: { class: "col-md-6" } },
  ],
});

class Table extends Component {
  @state rows: Row[] = [1, 2, 3].map((id) => ({ id, label: `row ${id}` }));
  @state selected = 0;
  @memoized
  select(id: number) {
    return () => {
      this.selected = id;
    };
  }
  @memoized
  remove(id: number) {
    return () => {
      this.rows = this.rows.filter((row) => row.id !== id);
    };
  }
  row(row: Row) {
    return __block(
      ROW,
      [this.selected === row.id ? "danger" : "", row.id, this.select(row.id), row.label, this.remove(row.id)],
      row.id,
    );
  }
  render() {
    return (
      <table>
        <tbody>{list(this.rows, this.row)}</tbody>
      </table>
    );
  }
}

describe("a compiled row", () => {
  test("is built, selected by its own handler, swapped by key and removed", async () => {
    const app = await getDOM<Table>(<Table />);
    await app.settle();
    const rows = () => Array.from(app.container.querySelectorAll("tr"));
    const built = rows().map((tr) => tr.outerHTML);
    const second = rows()[1];
    (second.querySelector("td:nth-child(2) a") as HTMLElement).click();
    await app.settle();
    const classes = rows().map((tr) => tr.className);
    app.instance.rows = [app.instance.rows[2], app.instance.rows[1], app.instance.rows[0]];
    await app.settle();
    const swapped = rows().map((tr) => tr.firstElementChild?.textContent);
    const kept = rows()[1] === second;
    (rows()[0].querySelector("td:nth-child(3) a") as HTMLElement).click();
    await app.settle();
    expect({
      first: built[0],
      classes,
      swapped,
      kept,
      left: rows().map((tr) => tr.firstElementChild?.textContent),
    }).toEqual({
      first:
        '<tr class=""><td class="col-md-1">1</td><td class="col-md-4"><a>row 1</a></td><td class="col-md-1"><a><span class="glyphicon" aria-hidden="true"></span></a></td><td class="col-md-6"></td></tr>',
      classes: ["", "danger", ""],
      swapped: ["3", "2", "1"],
      kept: true,
      left: ["2", "1"],
    });
  });
});

/** `<p>{this.content}</p>`, where the content is text, then markup, then nothing, then text again. */
const LONE = __template({ t: "p", h: 0 });

/** `<ul>{list(this.items, this.item)}</ul>`. */
const LISTED = __template({ t: "ul", h: 0 });

describe("a child hole", () => {
  test("holds text, then markup, then nothing, then text again", async () => {
    class Shifting extends Component {
      @state step = 0;
      content() {
        if (this.step === 0) return "plain";
        if (this.step === 1) return <b>bold</b>;
        if (this.step === 2) return null;
        return 42;
      }
      render() {
        return <div>{__block(LONE, [this.content()])}</div>;
      }
    }
    const app = await getDOM<Shifting>(<Shifting />);
    await app.settle();
    const p = app.container.querySelector("p") as HTMLElement;
    const seen = [p.innerHTML];
    for (const step of [1, 2, 3]) {
      app.instance.step = step;
      await app.settle();
      seen.push(p.innerHTML);
    }
    expect({ seen, same: app.container.querySelector("p") === p }).toEqual({
      seen: ["plain", "<b>bold</b>", "", "42"],
      same: true,
    });
  });

  test("holds a list, which keeps its rows", async () => {
    class Listing extends Component {
      @state items = ["a", "b"];
      item(name: string) {
        return <li key={name}>{name}</li>;
      }
      render() {
        return <div>{__block(LISTED, [list(this.items, this.item)])}</div>;
      }
    }
    const app = await getDOM<Listing>(<Listing />);
    await app.settle();
    const a = app.container.querySelector("li") as HTMLElement;
    app.instance.items = ["c", "a", "b"];
    await app.settle();
    const lis = Array.from(app.container.querySelectorAll("li"));
    expect({ text: lis.map((li) => li.textContent), kept: lis[1] === a }).toEqual({
      text: ["c", "a", "b"],
      kept: true,
    });
  });
});

/** `<p>Hello {name}, <b>welcome</b>{tail}</p>` — mixed children are one hole. */
const MIXED = __template({ t: "p", k: 0 });

describe("a children hole", () => {
  test("holds text, markup and a component, diffed as children are", async () => {
    class Badge extends Component<{ n: number }> {
      render() {
        return <i>{this.props.n}</i>;
      }
    }
    class Greeting extends Component {
      @state name = "Ana";
      @state n = 1;
      render() {
        return <div>{__block(MIXED, [["Hello ", this.name, ", ", <b>welcome</b>, <Badge n={this.n} />]])}</div>;
      }
    }
    const app = await getDOM<Greeting>(<Greeting />);
    await app.settle();
    const first = (app.container.querySelector("p") as HTMLElement).innerHTML;
    app.instance.name = "Iva";
    app.instance.n = 2;
    await app.settle();
    expect({ first, after: (app.container.querySelector("p") as HTMLElement).innerHTML }).toEqual({
      first: "Hello Ana, <b>welcome</b><i>1</i>",
      after: "Hello Iva, <b>welcome</b><i>2</i>",
    });
  });
});

describe("what the template is built from", () => {
  test("a row straight in a table stays where it was put — no <tbody> is added", async () => {
    const TABLE = __template({ t: "table", c: [{ t: "tr", c: [{ t: "td", h: 0 }] }] });
    class Grid extends Component {
      render() {
        return <div>{__block(TABLE, ["cell"])}</div>;
      }
    }
    const app = await getDOM<Grid>(<Grid />);
    await app.settle();
    expect((app.container.querySelector("table") as HTMLElement).innerHTML).toBe("<tr><td>cell</td></tr>");
  });

  test("an svg element is made in the svg namespace and written as one", async () => {
    const ICON = __template({ t: "svg", a: { viewBox: "0 0 2 2" }, c: [{ t: "circle", d: [["r", 0]] }] });
    class Icon extends Component {
      @state r = 1;
      render() {
        return <div>{__block(ICON, [this.r])}</div>;
      }
    }
    const app = await getDOM<Icon>(<Icon />);
    await app.settle();
    app.instance.r = 2;
    await app.settle();
    const circle = app.container.querySelector("circle") as SVGElement;
    expect({ ns: circle.namespaceURI, r: circle.getAttribute("r") }).toEqual({
      ns: "http://www.w3.org/2000/svg",
      r: "2",
    });
  });

  test("a field's value goes through the attribute rules: the model shows, the default is the attribute", async () => {
    const FIELD = __template({
      t: "input",
      d: [
        ["value", 0],
        ["oninput", 1],
      ],
    });
    class Field extends Component {
      @state text = "a";
      typed() {}
      render() {
        return <div>{__block(FIELD, [this.text, this.typed])}</div>;
      }
    }
    const app = await getDOM<Field>(<Field />);
    await app.settle();
    const input = app.container.querySelector("input") as HTMLInputElement;
    input.value = "typed";
    app.instance.text = "b";
    await app.settle();
    expect({ value: input.value, attribute: input.getAttribute("value") }).toEqual({ value: "b", attribute: "b" });
  });

  test("an svg element's class is written as an attribute", async () => {
    const MARK = __template({ t: "svg", c: [{ t: "circle", d: [["className", 0]] }] });
    class Mark extends Component {
      @state tone = "a";
      render() {
        return <div>{__block(MARK, [this.tone])}</div>;
      }
    }
    const app = await getDOM<Mark>(<Mark />);
    await app.settle();
    app.instance.tone = "b";
    await app.settle();
    expect((app.container.querySelector("circle") as SVGElement).getAttribute("class")).toBe("b");
  });

  test("an object in an attribute hole, changed in place, is written as it is now", async () => {
    const LINK = __template({ t: "a", d: [["href", 0]], c: ["next"] });
    class Pager extends Component {
      @state page = 1;
      readonly url = new URL("https://example.com/list?page=1");
      render() {
        this.url.searchParams.set("page", String(this.page));
        return <nav>{__block(LINK, [this.url])}</nav>;
      }
    }
    const app = await getDOM<Pager>(<Pager />);
    await app.settle();
    app.instance.page = 2;
    await app.settle();
    expect((app.container.querySelector("a") as HTMLAnchorElement).getAttribute("href")).toBe(
      "https://example.com/list?page=2",
    );
  });
});

describe("a child hole's text someone else took out", () => {
  test("is put back on the next render", async () => {
    class Label extends Component {
      @state text = "a";
      render() {
        return <div>{__block(LONE, [this.text])}</div>;
      }
    }
    const app = await getDOM<Label>(<Label />);
    await app.settle();
    const p = app.container.querySelector("p") as HTMLElement;
    (p.firstChild as ChildNode).remove();
    app.instance.text = "b";
    await app.settle();
    expect(p.innerHTML).toBe("b");
  });
});

/** `<button onclick={…}>{label}</button>`, served and then hydrated. */
const BUTTON = __template({ t: "button", d: [["onclick", 0]], h: 1 });

/** `<span>{text}</span>`. */
const LABEL = __template({ t: "span", h: 0 });

/** `<p><b>{text}</b></p>` — a site below the root, whose element hydration checks. */
const CARD = __template({ t: "p", c: [{ t: "b", h: 0 }] });

class Card extends Component {
  render() {
    return <div id="card">{__block(CARD, ["card"])}</div>;
  }
}

describe("a block a server rendered", () => {
  class Counter extends Component {
    @state count = 0;
    bump() {
      this.count++;
    }
    render() {
      return <div id="counter">{__block(BUTTON, [this.bump, `clicked ${this.count}`])}</div>;
    }
  }

  async function served(markup?: string) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = markup ?? (await renderToString(<Counter />));
    return container;
  }

  test("is adopted, not built: the server's button is the one that answers and updates", async () => {
    const container = await served();
    const button = container.querySelector("button") as HTMLButtonElement;
    hydrateRoot(<Counter />, container);
    await Promise.resolve();
    await Promise.resolve();
    button.click();
    flushSync();
    const after = { same: container.querySelector("button") === button, text: button.textContent };
    container.remove();
    expect(after).toEqual({ same: true, text: "clicked 1" });
  });

  test("holding an empty text, which the server sends as nothing, takes the next text", async () => {
    class Note extends Component {
      @state text = "";
      render() {
        return <div id="note">{__block(LABEL, [this.text])}</div>;
      }
    }
    const container = await served(await renderToString(<Note />));
    hydrateRoot(<Note />, container);
    await Promise.resolve();
    await Promise.resolve();
    const note = componentAt(container.querySelector("#note") as Element) as Note;
    note.text = "written";
    flushSync();
    const after = (container.querySelector("span") as HTMLElement).innerHTML;
    container.remove();
    expect(after).toBe("written");
  });

  test("whose markup is not the template's is built instead", async () => {
    // The server's markup, with the element under the root changed: the root matches, the inside does not.
    const markup = (await renderToString(<Card />)).replace("<b>", "<i>").replace("</b>", "</i>");
    const container = await served(markup);
    hydrateRoot(<Card />, container);
    await Promise.resolve();
    await Promise.resolve();
    const after = {
      inner: (container.querySelector("p") as HTMLElement).innerHTML,
      stray: container.querySelector("i"),
    };
    container.remove();
    expect(after).toEqual({ inner: "<b>card</b>", stray: null });
  });
});

/** `<section>{this.props.children}</section>` and `<div>{list(…)}</div>`, as the compiler writes them. */
const SECTION = __template({ t: "section", h: 0 });
const HOLDER = __template({ t: "div", h: 0 });
const PRICE = __template({ t: "i", k: 0 });

describe("a list in a block, handed down as children", () => {
  test("rebuilds the rows that read what changed, though the markup around it settled", async () => {
    class Panel extends Component<{ children?: unknown }> {
      render() {
        return __block(SECTION, [this.props.children]);
      }
    }
    class Owner extends Component {
      @state currency = "EUR";
      readonly rows = [{ id: 1 }, { id: 2 }];
      price(row: { id: number }) {
        return __block(PRICE, [[row.id, " ", this.currency]], row.id);
      }
      render() {
        return <Panel>{[__block(HOLDER, [list(this.rows, this.price)], "d")]}</Panel>;
      }
    }
    const app = await getDOM<Owner>(<Owner />);
    await app.settle();
    app.instance.currency = "USD";
    await app.settle();
    expect(Array.from(app.container.querySelectorAll("i"), (i) => i.textContent)).toEqual(["1 USD", "2 USD"]);
  });
});
