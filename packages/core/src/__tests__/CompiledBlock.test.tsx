import { describe, test, expect, vi } from "vitest";
import { getDOM } from "../test/setup";
import { Component, state, list, memoized } from "../index";
import { __template, __block } from "../jsx-runtime";
import { renderToString } from "../hydration/ssr";
import { hydrateRoot } from "../hydration/hydrate";
import { flushSync } from "../testing";
import { componentAt } from "../core/DiffAndMerge";
import * as diffAndMerge from "../core/DiffAndMerge";
import { resetDiagnostics } from "../debug/diagnostics";
import * as attribute from "../core/Attribute";

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

/** `<div><button>Copy</button><i>tip</i><b>{count}</b></div>`. */
const TOOLBAR = __template({
  t: "div",
  c: [
    { t: "button", c: ["Copy"] },
    { t: "i", c: ["tip"] },
    { t: "b", h: 0 },
  ],
});

describe("a template's static parts", () => {
  test("stay as someone else left them, while the holes go on updating", async () => {
    class Toolbar extends Component {
      @state count = 0;
      render() {
        return <section>{__block(TOOLBAR, [this.count])}</section>;
      }
    }
    const app = await getDOM<Toolbar>(<Toolbar />);
    await app.settle();
    // A library's doing: the button's text written over, the tip taken out.
    (app.container.querySelector("button") as HTMLElement).textContent = "Copied!";
    (app.container.querySelector("i") as HTMLElement).remove();
    app.instance.count = 1;
    await app.settle();
    expect((app.container.querySelector("div") as HTMLElement).innerHTML).toBe("<button>Copied!</button><b>1</b>");
  });
});

/** Two routes' pages: the same root tag, different static content — what the server's markup is checked against. */
const HOME = __template({ t: "div", a: { id: "home" }, c: ["home"] });
const PLAYERS_LIST = __template({ t: "div", a: { id: "home" }, c: ["home", { t: "b", c: ["extra"] }] });

describe("a served block from another template", () => {
  test.each([
    ["its own attribute differs", __template({ t: "div", a: { id: "players" }, c: ["home"] })],
    ["its static text differs", __template({ t: "div", a: { id: "home" }, c: ["players"] })],
    ["it holds more than the template", PLAYERS_LIST],
  ])("is built, not kept, when %s", async (_name, served) => {
    let route = "server";
    class Route extends Component {
      render() {
        return <main>{__block(route === "server" ? served : HOME, [])}</main>;
      }
    }
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = await renderToString(<Route />);
    route = "client";
    hydrateRoot(<Route />, container);
    await Promise.resolve();
    await Promise.resolve();
    const html = (container.querySelector("main") as HTMLElement).innerHTML;
    container.remove();
    expect(html).toBe('<div id="home">home</div>');
  });
});

/** `<svg viewBox="0 0 2 2"><circle r={r} /></svg>` — an icon, served and hydrated. */
const DOT = __template({ t: "svg", a: { viewBox: "0 0 2 2" }, c: [{ t: "circle", d: [["r", 0]] }] });

describe("a block rooted in an svg element", () => {
  test("is adopted by hydration, the server's node kept", async () => {
    class Icon extends Component {
      render() {
        return <span>{__block(DOT, [1])}</span>;
      }
    }
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = await renderToString(<Icon />);
    const served = container.querySelector("svg");
    hydrateRoot(<Icon />, container);
    await Promise.resolve();
    await Promise.resolve();
    const kept = container.querySelector("svg") === served;
    container.remove();
    expect(kept).toBe(true);
  });
});

/** `<li id="view" title={title}>{label}</li>`, keyed "a". */
const VIEW = __template({ t: "li", a: { id: "view" }, d: [["title", 0]], h: 1, y: 2 });

describe("a keyed element and a block of the same key, taking turns", () => {
  test("are each built as what they are — neither takes the other's node", async () => {
    class Item extends Component {
      @state editing = false;
      render() {
        const edit = { className: "edit" };
        return (
          <ul>
            {this.editing ? (
              <li key="a" {...edit}>
                editing
              </li>
            ) : (
              __block(VIEW, ["shown", "label", "a"])
            )}
          </ul>
        );
      }
    }
    const app = await getDOM<Item>(<Item />);
    await app.settle();
    const seen: string[] = [];
    for (const editing of [true, false]) {
      app.instance.editing = editing;
      await app.settle();
      seen.push((app.container.querySelector("ul") as HTMLElement).innerHTML);
    }
    expect(seen).toEqual(['<li class="edit">editing</li>', '<li id="view" title="shown">label</li>']);
  });
});

describe("a served block whose root carries what only the server wrote", () => {
  test("is adopted, and the server's own attribute goes", async () => {
    class Marked extends Component {
      render() {
        return <div>{__block(HOME, [])}</div>;
      }
    }
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = await renderToString(<Marked />);
    const served = container.querySelector("#home") as HTMLElement;
    served.setAttribute("data-served", "1");
    hydrateRoot(<Marked />, container);
    await Promise.resolve();
    await Promise.resolve();
    const after = { kept: container.querySelector("#home") === served, html: served.outerHTML };
    container.remove();
    expect(after).toEqual({ kept: true, html: '<div id="home">home</div>' });
  });
});

describe("a served block whose template bakes a name the HTML parser folds", () => {
  test("keeps the attribute: `tabIndex` is the page's `tabindex`", async () => {
    const FOCUSABLE = __template({ t: "div", a: { tabIndex: "0" }, c: ["x"] });
    class Card extends Component {
      render() {
        return <main>{__block(FOCUSABLE, [])}</main>;
      }
    }
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = await renderToString(<Card />);
    const served = container.querySelector("div") as HTMLElement;
    hydrateRoot(<Card />, container);
    await Promise.resolve();
    await Promise.resolve();
    const after = { kept: container.querySelector("div") === served, html: served.outerHTML };
    container.remove();
    expect(after).toEqual({ kept: true, html: '<div tabindex="0">x</div>' });
  });
});

describe("a served block whose hole names an attribute by another spelling", () => {
  test.each([
    [
      "`readOnly` is the page's `readonly`",
      __template({ t: "input", d: [["readOnly", 0]] }),
      true,
      "input",
      "readonly",
    ],
    [
      "`htmlFor` is the page's `for`",
      __template({ t: "label", d: [["htmlFor", 0]], c: ["Name"] }),
      "name",
      "label",
      "for",
    ],
  ])("takes away what only the server wrote for it: %s", async (_name, template, served, tag, attribute) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let value: unknown = served;
    class Field extends Component {
      render() {
        return <form>{__block(template, [value])}</form>;
      }
    }
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = await renderToString(<Field />);
    value = tag === "input" ? false : undefined;
    hydrateRoot(<Field />, container);
    await Promise.resolve();
    await Promise.resolve();
    const element = container.querySelector(tag) as HTMLElement;
    const written = element.hasAttribute(attribute);
    container.remove();
    vi.restoreAllMocks();
    expect(written).toBe(false);
  });
});

describe("a served block's static elements", () => {
  test("are not searched for what only the server wrote when they hold exactly what the template bakes", async () => {
    const LIST = __template({
      t: "ul",
      a: { id: "list" },
      c: [
        { t: "li", a: { title: "a" }, c: ["one"] },
        { t: "li", a: { title: "b" }, c: ["two"] },
        { t: "li", d: [["title", 0]], c: ["three"] },
      ],
    });
    class List extends Component {
      render() {
        return <main>{__block(LIST, ["c"])}</main>;
      }
    }
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = await renderToString(<List />);
    const searched = vi.spyOn(attribute, "dropServerOnly");
    hydrateRoot(<List />, container);
    await Promise.resolve();
    await Promise.resolve();
    const elements = searched.mock.calls.map((call) => (call[0] as Element).textContent);
    searched.mockRestore();
    container.remove();
    // Only the element with a hole: the list and its two static items are skipped.
    expect(elements).toEqual(["three"]);
  });
});

describe("a served block from another template, in development", () => {
  test.each([
    [
      "its own attribute",
      __template({ t: "div", a: { id: "players" }, c: ["home"] }),
      'id="home" on <div>, from its compiled template, but the server sent id="players" on <div>',
    ],
    [
      "its static text",
      __template({ t: "div", a: { id: "home" }, c: ["players"] }),
      'the text "home", from its compiled template, but the server sent the text "players"',
    ],
    ["what it holds", PLAYERS_LIST, "nothing more in <div>, from its compiled template, but the server sent <b>"],
    [
      "what it lacks",
      __template({ t: "div", a: { id: "home" } }),
      'the text "home", from its compiled template, but the server sent nothing',
    ],
    [
      "an element inside it",
      __template({ t: "div", a: { id: "home" }, c: [{ t: "i", c: ["home"] }] }),
      'the text "home", from its compiled template, but the server sent <i>',
    ],
    [
      "an element's own tag",
      __template({ t: "div", a: { id: "home" }, c: [{ t: "i", c: ["x"] }] }),
      "<b>, from its compiled template, but the server sent <i>",
      __template({ t: "div", a: { id: "home" }, c: [{ t: "b", c: ["x"] }] }),
    ],
  ])("is reported once, at where %s differs", async (_name, served, message, client = HOME) => {
    const records: { code: string; message: string }[] = [];
    globalThis.__RAMONDA_DIAGNOSTICS__ = (record) => records.push(record);
    resetDiagnostics();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    let route = "server";
    class Route extends Component {
      render() {
        return <main>{__block(route === "server" ? served : client, [])}</main>;
      }
    }
    const container = document.createElement("div");
    document.body.appendChild(container);
    try {
      container.innerHTML = await renderToString(<Route />);
      route = "client";
      hydrateRoot(<Route />, container);
      await Promise.resolve();
      await Promise.resolve();
    } finally {
      globalThis.__RAMONDA_DIAGNOSTICS__ = undefined;
      warn.mockRestore();
      log.mockRestore();
      container.remove();
    }
    const mismatch = records.filter((record) => record.code === "RMD007").map((record) => record.message);
    expect(mismatch).toEqual([`Server and client rendered different output: <Route /> rendered ${message}.`]);
  });
});

/** What the test below changes on its component. */
interface Boxed {
  text: string;
  other: number;
}

/** `<p>{children}</p>` where the children are JSX's own: a children hole. */
const KIDS = __template({ t: "p", k: 0 });

describe("a child hole over a served element holding more than it does", () => {
  const text = (box: Boxed): unknown => box.text;
  const greeting = (box: Boxed): unknown => ["Hi ", box.text];
  // The same element on every render, as a memoized one is: a value that compares equal.
  const emphasis = <i>x</i>;
  const emphasized = (): unknown => emphasis;
  test.each([
    ["a text hole, when the text changes", LONE, text, (box: Boxed) => (box.text = "y"), "<p>y</p>"],
    ["a text hole, when only something else changes", LONE, text, (box: Boxed) => (box.other = 1), "<p>x</p>"],
    [
      "a hole holding markup, when only something else changes",
      LONE,
      emphasized,
      (box: Boxed) => (box.other = 1),
      "<p><i>x</i></p>",
    ],
    [
      "a children hole, when only something else changes",
      KIDS,
      greeting,
      (box: Boxed) => (box.other = 1),
      "<p>Hi x</p>",
    ],
  ])(
    "loses what only the server sent on the first update, as an element the diff adopts does — %s",
    async (_name, template, holds, update, after) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      let served = true;
      class Box extends Component {
        @state text = "x";
        @state other = 0;
        render() {
          const value = holds(this as unknown as Boxed);
          const page = served ? [...(Array.isArray(value) ? value : [value]), <b>stray</b>] : value;
          return (
            <div id="box" data-other={this.other}>
              {__block(template, [page])}
            </div>
          );
        }
      }
      const container = document.createElement("div");
      document.body.appendChild(container);
      try {
        container.innerHTML = await renderToString(<Box />);
        served = false;
        hydrateRoot(<Box />, container);
        await Promise.resolve();
        await Promise.resolve();
        const box = componentAt(container.querySelector("#box") as Element) as unknown as Boxed;
        update(box);
        flushSync();
        const html = (container.querySelector("p") as HTMLElement).outerHTML;
        // Settled once: the next render that changes nothing of the hole does not diff its children again.
        const diffed = vi.spyOn(diffAndMerge, "diffChildrenOf");
        box.other = 2;
        flushSync();
        const again = diffed.mock.calls.filter((call) => (call[0] as Element).nodeName === "P").length;
        diffed.mockRestore();
        expect({ html, again }).toEqual({ html: after, again: 0 });
      } finally {
        warn.mockRestore();
        container.remove();
      }
    },
  );
});

/** `<div id="head">{header}</div>` and `<h2>{title}</h2>`: a block passed into another block's hole. */
const HEAD = __template({ t: "div", a: { id: "head" }, h: 0 });
const TITLE = __template({ t: "h2", h: 0 });

describe("a block inside another block's hole, served holding more than it does", () => {
  test("loses it on the first update, though the hole holds the same block — as the diff would reach it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let served = true;
    // The same element on every render, as a prop handed down unchanged is.
    const header = __block(TITLE, ["Title"]);
    class Panel extends Component {
      @state open = false;
      render() {
        const held = served ? __block(TITLE, [["Title", <b>stale</b>]]) : header;
        return (
          <section id="panel">
            {__block(HEAD, [held])}
            {this.open && <p>body</p>}
          </section>
        );
      }
    }
    const container = document.createElement("div");
    document.body.appendChild(container);
    try {
      container.innerHTML = await renderToString(<Panel />);
      served = false;
      hydrateRoot(<Panel />, container);
      await Promise.resolve();
      await Promise.resolve();
      (componentAt(container.querySelector("#panel") as Element) as Panel).open = true;
      flushSync();
      expect((container.querySelector("#head") as HTMLElement).innerHTML).toBe("<h2>Title</h2>");
    } finally {
      warn.mockRestore();
      container.remove();
    }
  });
});

/** `<button id="save" title="Save" aria-label={label}>go</button>`. */
const SAVE = __template({ t: "button", a: { id: "save", title: "Save" }, d: [["aria-label", 0]], c: ["go"] });

describe("an attribute pass on a block that threw", () => {
  test("leaves the template's own attributes where they are, on the pass after it", async () => {
    class Toolbar extends Component {
      @state label: unknown = "Save the draft";
      render() {
        return <div>{__block(SAVE, [this.label])}</div>;
      }
    }
    const app = await getDOM<Toolbar>(<Toolbar />);
    await app.settle();
    // A value that cannot be written: the pass throws halfway, and keeps no record.
    app.instance.label = {
      toString() {
        throw new Error("no text");
      },
    };
    let threw = false;
    try {
      await app.settle();
    } catch {
      threw = true;
    }
    app.instance.label = "Save it";
    await app.settle();
    const button = app.container.querySelector("button") as HTMLElement;
    expect({ threw, id: button.id, title: button.title, label: button.getAttribute("aria-label") }).toEqual({
      threw: true,
      id: "save",
      title: "Save",
      label: "Save it",
    });
  });
});

/** `<div><span title={a}>{t}</span><b aria-label={label}>x</b></div>`. */
const TWO_SITES = __template({
  t: "div",
  c: [
    { t: "span", d: [["title", 0]], h: 1 },
    { t: "b", d: [["aria-label", 2]], c: ["x"] },
  ],
});

describe("an update of a block that threw halfway", () => {
  test("is written again in full by the next one, even back to the values before it", async () => {
    const unwritable = {
      toString() {
        throw new Error("no text");
      },
    };
    class Card extends Component {
      @state values: unknown[] = ["x", "one", "fine"];
      render() {
        return <main>{__block(TWO_SITES, this.values)}</main>;
      }
    }
    const app = await getDOM<Card>(<Card />);
    await app.settle();
    // The first site takes the new values; the second throws.
    app.instance.values = ["y", "two", unwritable];
    let threw = false;
    try {
      await app.settle();
    } catch {
      threw = true;
    }
    app.instance.values = ["x", "one", "fine"];
    await app.settle();
    const span = app.container.querySelector("span") as HTMLElement;
    expect({ threw, title: span.title, text: span.textContent }).toEqual({ threw: true, title: "x", text: "one" });
  });
});

/** `<button onclick={listener}>go</button>`. */
const LISTENED = __template({ t: "button", d: [["onclick", 0]], c: ["go"] });

describe("an attribute hole holding a listener object", () => {
  test("is the same listener while it is the same object — the element is not diffed again", async () => {
    const listener = { handleEvent() {} };
    class Toolbar extends Component {
      @state count = 0;
      render() {
        return <div data-count={this.count}>{__block(LISTENED, [listener])}</div>;
      }
    }
    const app = await getDOM<Toolbar>(<Toolbar />);
    await app.settle();
    // Both ways an element's attributes are diffed: an element's own, and a block's holes.
    const diffed = [vi.spyOn(attribute, "applyChangesOnAttributes"), vi.spyOn(attribute, "writeHoleAttributes")];
    app.instance.count = 1;
    await app.settle();
    const nodes = diffed.flatMap((spy) => spy.mock.calls.map((call) => (call[0] as Element).nodeName));
    for (const spy of diffed) spy.mockRestore();
    expect(nodes).toEqual(["DIV"]);
  });
});

describe("a child hole built holding markup", () => {
  test("holds the markup and nothing else", async () => {
    class Boxed extends Component {
      render() {
        return <div>{__block(LONE, [<b>bold</b>])}</div>;
      }
    }
    const app = await getDOM<Boxed>(<Boxed />);
    await app.settle();
    const p = app.container.querySelector("p") as HTMLElement;
    expect(Array.from(p.childNodes, (node) => node.nodeName)).toEqual(["B"]);
  });
});
