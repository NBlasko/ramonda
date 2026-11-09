import { describe, test, expect, vi } from "vitest";
import { getDOM } from "../test/setup";
import { state, destroyed } from "../base/decorators";
import { Component, __h, createRef, list, type EventOn } from "../index";
import { renderToString } from "../hydration/ssr";
import { hydrateRoot } from "../hydration/hydrate";
import { componentAt } from "../core/DiffAndMerge";
import { flushSync } from "../testing";

/**
 * What the diff reads back from an element it has just built.
 *
 * Nothing is there to read: a new element has no attributes and no children until the diff writes
 * them. Built through the update path, every new element was asked for its attributes and its
 * `childNodes` anyway, and its children went in through the reorder pass one by one — measured on
 * js-framework-benchmark's create, 28 reads of an empty element per row, and a sixth of the time.
 */
describe("an element the diff builds", () => {
  interface Row {
    readonly id: number;
    readonly label: string;
  }

  class Table extends Component {
    @state rows: Row[] = [];
    row(row: Row) {
      return (
        <tr key={row.id} className="row">
          <td className="id">{row.id}</td>
          <td>
            <a title={row.label}>{row.label}</a>
          </td>
          <td>
            <span aria-hidden="true">x</span>
          </td>
        </tr>
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

  /** Counts reads of `name` on nodes inside a row. */
  function counting(proto: object, name: string, tally: { reads: number }) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, name) as PropertyDescriptor;
    Object.defineProperty(proto, name, {
      ...descriptor,
      get(this: Node) {
        if ((this.nodeType === Node.ELEMENT_NODE ? (this as Element) : this.parentElement)?.closest("tr"))
          tally.reads++;
        return descriptor.get?.call(this);
      },
    });
    return () => Object.defineProperty(proto, name, descriptor);
  }

  test("is written, never read back, and holds what it was written", async () => {
    const app = await getDOM<Table>(<Table />);
    await app.settle();
    const tally = { reads: 0 };
    const undo = [counting(Element.prototype, "attributes", tally), counting(Node.prototype, "childNodes", tally)];
    try {
      app.instance.rows = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, label: `row ${i + 1}` }));
      await app.settle();
    } finally {
      for (const u of undo) u();
    }
    const tbody = app.container.querySelector("tbody") as HTMLElement;
    expect({ reads: tally.reads, rows: tbody.children.length, first: tbody.firstElementChild?.outerHTML }).toEqual({
      reads: 0,
      rows: 10,
      first:
        '<tr class="row"><td class="id">1</td><td><a title="row 1">row 1</a></td><td><span aria-hidden="true">x</span></td></tr>',
    });
  });
});

/**
 * An element the diff UPDATES is compared with what the diff wrote on it last time, not read back from
 * the page. Reading every attribute back on every pass was the largest single cost in every profile of
 * js-framework-benchmark, and it made the page the record of what Ramonda meant: an attribute anyone
 * else changed — the browser closing a `<details>`, a library's class — was written back on the next
 * render that touched the element for any reason at all. What Ramonda wrote is the record now, as in
 * React: such a change stays until Ramonda itself changes that value. An element it never wrote — one a
 * hydration adopted — is read from the page once.
 */
describe("an element the diff updates", () => {
  class Panel extends Component {
    @state renders = 0;
    @state tone = "a";
    render() {
      return (
        <section data-renders={this.renders}>
          <details id="more" open>
            <summary>More</summary>
          </details>
          <p id="tone" className={this.tone}>
            tone
          </p>
        </section>
      );
    }
  }

  test("is not read back from the page", async () => {
    const app = await getDOM<Panel>(<Panel />);
    await app.settle();
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, "attributes") as PropertyDescriptor;
    let reads = 0;
    Object.defineProperty(Element.prototype, "attributes", {
      ...descriptor,
      get(this: Element) {
        reads++;
        return descriptor.get?.call(this);
      },
    });
    try {
      app.instance.tone = "b";
      app.instance.renders++;
      await app.settle();
    } finally {
      Object.defineProperty(Element.prototype, "attributes", descriptor);
    }
    expect({ reads, tone: (app.container.querySelector("#tone") as HTMLElement).className }).toEqual({
      reads: 0,
      tone: "b",
    });
  });

  test("takes nothing away that it did not write — an attribute held as nothing costs no call", async () => {
    class Quiet extends Component {
      @state renders = 0;
      render() {
        return (
          <p id="quiet" data-renders={this.renders} title={undefined} hidden={false}>
            quiet
          </p>
        );
      }
    }
    const app = await getDOM<Quiet>(<Quiet />);
    await app.settle();
    const remove = Element.prototype.removeAttribute;
    let removed = 0;
    Element.prototype.removeAttribute = function (this: Element, name: string) {
      removed++;
      return remove.call(this, name);
    };
    try {
      for (let i = 0; i < 3; i++) {
        app.instance.renders++;
        await app.settle();
      }
    } finally {
      Element.prototype.removeAttribute = remove;
    }
    expect(removed).toBe(0);
  });

  test("a ref the render stops giving is let go, with no attribute call", async () => {
    class Held extends Component {
      @state held = true;
      readonly box = createRef<HTMLElement>();
      render() {
        return this.held ? <p ref={this.box}>held</p> : <p>held</p>;
      }
    }
    const app = await getDOM<Held>(<Held />);
    await app.settle();
    const remove = Element.prototype.removeAttribute;
    const removed: string[] = [];
    Element.prototype.removeAttribute = function (this: Element, name: string) {
      removed.push(name);
      return remove.call(this, name);
    };
    try {
      app.instance.held = false;
      await app.settle();
    } finally {
      Element.prototype.removeAttribute = remove;
    }
    expect({ removed, current: app.instance.box.current }).toEqual({ removed: [], current: null });
  });

  test("a pass that throws halfway leaves no record: the next one reads what it wrote", async () => {
    const clicked: string[] = [];
    class Shaky extends Component {
      @state step = 0;
      first() {
        clicked.push("first");
      }
      second() {
        clicked.push("second");
      }
      attributes(): Record<string, unknown> {
        if (this.step === 0) return { onclick: this.first };
        // A name the DOM refuses: `setAttribute` throws after the new handler is attached.
        if (this.step === 1) return { onclick: this.second, "bad name": "x" };
        return {};
      }
      render() {
        return <div>{__h("button", this.attributes() as never, "b")}</div>;
      }
    }
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const app = await getDOM<Shaky>(<Shaky />);
      await app.settle();
      for (const step of [1, 2]) {
        app.instance.step = step;
        // The throwing pass reaches the test as the commit's error; what matters is the pass after it.
        try {
          await app.settle();
        } catch {
          // the step-1 pass
        }
      }
      (app.container.querySelector("button") as HTMLButtonElement).click();
    } finally {
      errors.mockRestore();
    }
    expect(clicked).toEqual([]);
  });

  test("an object value changed in place is written as it is now", async () => {
    class Pager extends Component {
      @state page = 1;
      readonly url = new URL("https://example.com/list?page=1");
      render() {
        this.url.searchParams.set("page", String(this.page));
        return <nav>{__h("a", { href: this.url } as never, "next")}</nav>;
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

  test("keeps what the browser changed — a <details> the reader closed stays closed", async () => {
    const app = await getDOM<Panel>(<Panel />);
    await app.settle();
    const details = app.container.querySelector("#more") as HTMLDetailsElement;
    details.open = false;
    app.instance.renders++;
    await app.settle();
    expect(details.open).toBe(false);
  });

  test("keeps a class someone else set, until Ramonda writes its own again", async () => {
    const app = await getDOM<Panel>(<Panel />);
    await app.settle();
    const tone = app.container.querySelector("#tone") as HTMLElement;
    tone.className = "theirs";
    app.instance.renders++;
    await app.settle();
    const kept = tone.className;
    app.instance.tone = "c";
    await app.settle();
    expect({ kept, written: tone.className }).toEqual({ kept: "theirs", written: "c" });
  });

  test("an element a hydration adopted is read from the page: what only the server wrote goes", async () => {
    class Served extends Component<{ server?: boolean }> {
      @state renders = 0;
      render() {
        return (
          <div id="served" data-renders={this.renders} {...(this.props.server ? { "data-server": "1" } : {})}>
            x
          </div>
        );
      }
    }
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = await renderToString(<Served server />);
    hydrateRoot(<Served />, container);
    await Promise.resolve();
    await Promise.resolve();
    (componentAt(container.querySelector("#served") as Element) as Served).renders++;
    flushSync();
    const left = (container.querySelector("#served") as HTMLElement).hasAttribute("data-server");
    container.remove();
    expect(left).toBe(false);
  });
});

/**
 * An element's own children are kept as the diff placed them, the way its attributes are: the next pass
 * claims from that record, not from the page's `childNodes`. A child someone else took out is not in
 * the element any more, so the record is not trusted for that pass — the page is read and the child is
 * put back. A child someone else added is no child the diff placed, so it stays.
 */
describe("an element's own children on an update", () => {
  class Rows extends Component {
    @state renders = 0;
    @state picked = 0;
    render() {
      // Written out, not mapped: an array of keyed rows is a region, whose record is its own.
      return (
        <ul data-renders={this.renders}>
          <li id="i1" className={this.picked === 1 ? "on" : ""}>
            <b>1</b>
            <i>row</i>
          </li>
          <li id="i2" className={this.picked === 2 ? "on" : ""}>
            <b>2</b>
            <i>row</i>
          </li>
          <li id="i3" className={this.picked === 3 ? "on" : ""}>
            <b>3</b>
            <i>row</i>
          </li>
        </ul>
      );
    }
  }

  test("are not read back from the page", async () => {
    const app = await getDOM<Rows>(<Rows />);
    await app.settle();
    // `childNodes` for the pool, `firstChild` / `nextSibling` for the order the reorder pass walks.
    const names = ["childNodes", "firstChild", "nextSibling"] as const;
    const descriptors = names.map(
      (name) => Object.getOwnPropertyDescriptor(Node.prototype, name) as PropertyDescriptor,
    );
    let reads = 0;
    names.forEach((name, i) => {
      Object.defineProperty(Node.prototype, name, {
        ...descriptors[i],
        get(this: Node) {
          // The list's own `nextSibling` is the component's boundary, read by the component — not the children.
          if (name === "nextSibling" && this.nodeName === "UL") return descriptors[i].get?.call(this);
          if ((this.nodeType === Node.ELEMENT_NODE ? (this as Element) : this.parentElement)?.closest("ul")) reads++;
          return descriptors[i].get?.call(this);
        },
      });
    });
    try {
      app.instance.picked = 2;
      app.instance.renders++;
      await app.settle();
    } finally {
      names.forEach((name, i) => Object.defineProperty(Node.prototype, name, descriptors[i]));
    }
    expect({ reads, on: (app.container.querySelector("#i2") as HTMLElement).className }).toEqual({
      reads: 0,
      on: "on",
    });
  });

  test("a child someone else took out is put back on the next render", async () => {
    const app = await getDOM<Rows>(<Rows />);
    await app.settle();
    (app.container.querySelector("#i2") as HTMLElement).remove();
    // A change among the children, so the diff walks them; unchanged children are skipped whole.
    app.instance.picked = 3;
    await app.settle();
    expect(Array.from(app.container.querySelectorAll("li"), (li) => li.id)).toEqual(["i1", "i2", "i3"]);
  });

  test("a child someone else added stays", async () => {
    const app = await getDOM<Rows>(<Rows />);
    await app.settle();
    const theirs = document.createElement("li");
    theirs.id = "theirs";
    (app.container.querySelector("ul") as HTMLElement).append(theirs);
    app.instance.picked = 3;
    await app.settle();
    expect(Array.from(app.container.querySelectorAll("li"), (li) => li.id)).toEqual(["i1", "i2", "i3", "theirs"]);
  });

  test("children someone else moved keep the order they were moved to", async () => {
    const app = await getDOM<Rows>(<Rows />);
    await app.settle();
    const ul = app.container.querySelector("ul") as HTMLElement;
    ul.prepend(ul.querySelector("#i3") as HTMLElement);
    app.instance.picked = 1;
    await app.settle();
    expect(Array.from(ul.children, (li) => li.id)).toEqual(["i3", "i1", "i2"]);
  });

  test("a child someone else replaced is claimed, not built a second time beside it", async () => {
    class Copy extends Component {
      @state renders = 0;
      render() {
        return (
          <div data-renders={this.renders}>
            <button type="button">Copy</button>
          </div>
        );
      }
    }
    const app = await getDOM<Copy>(<Copy />);
    await app.settle();
    const button = app.container.querySelector("button") as HTMLButtonElement;
    button.textContent = "Copied!";
    app.instance.renders++;
    await app.settle();
    expect({ text: button.textContent, nodes: button.childNodes.length }).toEqual({ text: "Copy", nodes: 1 });
  });

  test("a child a @destroyed takes out while the order stays is put back", async () => {
    let victim: Element | null = null;
    class Widget extends Component {
      @destroyed
      gone() {
        victim?.remove();
      }
      render() {
        return <em>w</em>;
      }
    }
    class Holder extends Component {
      @state shown = true;
      render() {
        return (
          <div>
            <p id="kept">kept</p>
            <span id="s">{this.shown ? <Widget /> : null}</span>
          </div>
        );
      }
    }
    const app = await getDOM<Holder>(<Holder />);
    await app.settle();
    victim = app.container.querySelector("#kept");
    app.instance.shown = false;
    await app.settle();
    const div = app.container.querySelector("div") as HTMLElement;
    expect(Array.from(div.children, (child) => child.id)).toEqual(["kept", "s"]);
  });

  test("a pass that drops a child places the rest from the record, not from the page", async () => {
    class Optional extends Component {
      @state middle = true;
      render() {
        return (
          <ul>
            <li id="a">a</li>
            {this.middle ? <li id="b">b</li> : null}
            <li id="c">c</li>
          </ul>
        );
      }
    }
    const app = await getDOM<Optional>(<Optional />);
    await app.settle();
    const ul = app.container.querySelector("ul") as HTMLElement;
    const names = ["childNodes", "firstChild"] as const;
    const descriptors = names.map(
      (name) => Object.getOwnPropertyDescriptor(Node.prototype, name) as PropertyDescriptor,
    );
    let reads = 0;
    names.forEach((name, i) => {
      Object.defineProperty(Node.prototype, name, {
        ...descriptors[i],
        get(this: Node) {
          if (this === ul) reads++;
          return descriptors[i].get?.call(this);
        },
      });
    });
    try {
      app.instance.middle = false;
      await app.settle();
    } finally {
      names.forEach((name, i) => Object.defineProperty(Node.prototype, name, descriptors[i]));
    }
    expect({ reads, ids: Array.from(ul.children, (li) => li.id) }).toEqual({ reads: 0, ids: ["a", "c"] });
  });

  test("a child a @destroyed takes out on the pass that keeps it goes back in", async () => {
    let victim: Element | null = null;
    class Widget extends Component {
      @destroyed
      gone() {
        victim?.remove();
      }
      render() {
        return <em>w</em>;
      }
    }
    class Shifting extends Component {
      @state phase = 0;
      render() {
        return (
          <div>
            {this.phase === 1 ? <b id="new">new</b> : null}
            <p id="kept">kept</p>
            {this.phase === 0 ? (
              <span>
                <Widget />
              </span>
            ) : null}
          </div>
        );
      }
    }
    const app = await getDOM<Shifting>(<Shifting />);
    await app.settle();
    victim = app.container.querySelector("#kept");
    app.instance.phase = 1;
    await app.settle();
    const div = app.container.querySelector("div") as HTMLElement;
    expect(Array.from(div.children, (child) => child.id)).toEqual(["new", "kept"]);
  });
});

/**
 * A row of a list, handed back as the same vnode when only a list inside it changed. Its attributes are
 * compared with what was written on it, as any element's are: a class a library added stays.
 */
describe("a list row reopened for a list inside it", () => {
  interface Cat {
    readonly id: number;
    readonly name: string;
  }

  class Catalogue extends Component {
    @state currency = "EUR";
    readonly cats: Cat[] = [{ id: 1, name: "Books" }];
    readonly prices = [1, 2];
    price(amount: number) {
      return (
        <li key={amount}>
          {amount} {this.currency}
        </li>
      );
    }
    cat(cat: Cat) {
      return (
        <li key={cat.id} id={`cat-${cat.id}`} className="cat">
          {cat.name}
          <ul>{list(this.prices, this.price)}</ul>
        </li>
      );
    }
    render() {
      return <ul>{list(this.cats, this.cat)}</ul>;
    }
  }

  test("keeps a class a library added to it", async () => {
    const app = await getDOM<Catalogue>(<Catalogue />);
    await app.settle();
    const row = app.container.querySelector("#cat-1") as HTMLElement;
    row.classList.add("open-by-library");
    app.instance.currency = "RSD";
    await app.settle();
    expect({ className: row.className, text: row.textContent }).toEqual({
      className: "cat open-by-library",
      text: "Books1 RSD2 RSD",
    });
  });
});

/**
 * What the record of written attributes cannot answer alone: a default written under another name, and
 * state an element keeps only in a property, which the browser changes behind the record.
 */
describe("what an element's attribute record does not hold", () => {
  class Field extends Component {
    @state step = 0;
    render() {
      return (
        <div>
          {this.step === 0 ? <input defaultValue="old" /> : <input placeholder="new" />}
          {this.step === 0 ? <input type="checkbox" defaultChecked /> : <input type="checkbox" />}
        </div>
      );
    }
  }

  test("a default the render stops naming is taken away", async () => {
    const app = await getDOM<Field>(<Field />);
    await app.settle();
    app.instance.step = 1;
    await app.settle();
    const [text, box] = Array.from(app.container.querySelectorAll("input"));
    expect({ value: text.getAttribute("value"), checked: box.hasAttribute("checked"), ticked: box.checked }).toEqual({
      value: null,
      checked: false,
      ticked: false,
    });
  });

  test("a default dropped beside the model's value leaves the model's attribute", async () => {
    class Held extends Component {
      @state step = 0;
      @state text = "model";
      @state on = true;
      typed(event: EventOn<HTMLInputElement>) {
        this.text = event.currentTarget.value;
      }
      toggled(event: EventOn<HTMLInputElement>) {
        this.on = event.currentTarget.checked;
      }
      render() {
        return this.step === 0 ? (
          <div>
            <input value={this.text} defaultValue="old" oninput={this.typed} />
            <input type="checkbox" checked={this.on} defaultChecked onchange={this.toggled} />
          </div>
        ) : (
          <div>
            <input value={this.text} oninput={this.typed} />
            <input type="checkbox" checked={this.on} onchange={this.toggled} />
          </div>
        );
      }
    }
    const app = await getDOM<Held>(<Held />);
    await app.settle();
    app.instance.step = 1;
    await app.settle();
    const [text, box] = Array.from(app.container.querySelectorAll("input"));
    expect({ value: text.getAttribute("value"), checked: box.hasAttribute("checked") }).toEqual({
      value: "model",
      checked: true,
    });
  });

  test("a default dropped for a model's `checked={false}` takes the attribute it wrote away", async () => {
    class Box extends Component {
      @state step = 0;
      toggled() {
        this.step = 2;
      }
      render() {
        return this.step === 0 ? (
          <input type="checkbox" defaultChecked />
        ) : (
          <input type="checkbox" checked={false} onchange={this.toggled} />
        );
      }
    }
    const app = await getDOM<Box>(<Box />);
    await app.settle();
    app.instance.step = 1;
    await app.settle();
    const box = app.container.querySelector("input") as HTMLInputElement;
    expect({ attribute: box.hasAttribute("checked"), ticked: box.checked }).toEqual({
      attribute: false,
      ticked: false,
    });
  });

  test("a default dropped beside a `checked` the render writes leaves that attribute", async () => {
    class Spread extends Component {
      @state step = 0;
      render() {
        // A `checked=""` as a spread hands it — written as the attribute, as any visible value is.
        const attributes =
          this.step === 0 ? { type: "checkbox", defaultChecked: true, checked: "" } : { type: "checkbox", checked: "" };
        return <div>{__h("input", attributes as never)}</div>;
      }
    }
    const app = await getDOM<Spread>(<Spread />);
    await app.settle();
    app.instance.step = 1;
    await app.settle();
    expect((app.container.querySelector("input") as HTMLInputElement).hasAttribute("checked")).toBe(true);
  });

  test("a volume the reader moved and a video's place stay on a render that does not change them", async () => {
    class Player extends Component {
      @state renders = 0;
      render() {
        return (
          <div data-renders={this.renders}>
            <video volume={0.5} currentTime={0} />
          </div>
        );
      }
    }
    const app = await getDOM<Player>(<Player />);
    await app.settle();
    const video = app.container.querySelector("video") as HTMLVideoElement;
    const written = video.volume;
    video.volume = 0.8;
    video.currentTime = 12;
    app.instance.renders++;
    await app.settle();
    expect({ written, volume: video.volume, at: video.currentTime }).toEqual({ written: 0.5, volume: 0.8, at: 12 });
  });

  test("a video the reader unmuted is muted again on the next render", async () => {
    class Quiet extends Component {
      @state renders = 0;
      render() {
        return (
          <div data-renders={this.renders}>
            <video muted />
          </div>
        );
      }
    }
    const app = await getDOM<Quiet>(<Quiet />);
    await app.settle();
    const video = app.container.querySelector("video") as HTMLVideoElement;
    video.muted = false;
    app.instance.renders++;
    await app.settle();
    expect(video.muted).toBe(true);
  });

  test("a checkbox the reader clicked out of mixed is mixed again on the next render", async () => {
    class Mixed extends Component {
      @state renders = 0;
      render() {
        return (
          <div data-renders={this.renders}>
            <input type="checkbox" aria-label="Some" indeterminate={true} />
          </div>
        );
      }
    }
    const app = await getDOM<Mixed>(<Mixed />);
    await app.settle();
    const box = app.container.querySelector("input") as HTMLInputElement;
    box.click();
    const cleared = box.indeterminate;
    app.instance.renders++;
    await app.settle();
    expect({ cleared, mixed: box.indeterminate }).toEqual({ cleared: false, mixed: true });
  });
});

/**
 * An element with one child — a cell's text, a link's label, the commonest shape on a page — keeps that
 * child on its own as its record, not in an array of one. It is held to the same rule as a longer record.
 */
describe("an element with one child on an update", () => {
  class Label extends Component {
    @state text = "a";
    render() {
      return (
        <p id="label">
          <b>{this.text}</b>
        </p>
      );
    }
  }

  test("is not read back from the page", async () => {
    const app = await getDOM<Label>(<Label />);
    await app.settle();
    const descriptor = Object.getOwnPropertyDescriptor(Node.prototype, "childNodes") as PropertyDescriptor;
    let reads = 0;
    Object.defineProperty(Node.prototype, "childNodes", {
      ...descriptor,
      get(this: Node) {
        if ((this as Element).id === "label") reads++;
        return descriptor.get?.call(this);
      },
    });
    try {
      app.instance.text = "b";
      await app.settle();
    } finally {
      Object.defineProperty(Node.prototype, "childNodes", descriptor);
    }
    expect({ reads, text: (app.container.querySelector("#label") as HTMLElement).textContent }).toEqual({
      reads: 0,
      text: "b",
    });
  });

  test("a child someone else took out is put back on the next render", async () => {
    const app = await getDOM<Label>(<Label />);
    await app.settle();
    const label = app.container.querySelector("#label") as HTMLElement;
    (label.firstElementChild as HTMLElement).remove();
    app.instance.text = "b";
    await app.settle();
    expect(label.innerHTML).toBe("<b>b</b>");
  });
});

/**
 * An element whose children are plain, then hold a region, then are plain again. The region keeps its
 * own record while it is there, and the plain one is dropped then: kept, it would still name the children
 * of before the region, and the next plain pass would claim from it — a child built while the region was
 * there would be left out of the pool, and built a second time.
 */
describe("an element whose children hold a region for a while", () => {
  class Shifting extends Component {
    @state phase: "plain" | "list" | "after" = "plain";
    @state renders = 0;
    readonly rows = [1, 2];
    row(id: number) {
      return <li className="row">{id}</li>;
    }
    render() {
      return (
        <ul data-renders={this.renders}>
          <li id="a">a</li>
          {this.phase === "list" ? list(this.rows, this.row) : null}
          {this.phase === "after" ? <li id="c">c</li> : null}
        </ul>
      );
    }
  }

  test("ends with each child once", async () => {
    const app = await getDOM<Shifting>(<Shifting />);
    await app.settle();
    for (const phase of ["list", "after"] as const) {
      app.instance.phase = phase;
      await app.settle();
    }
    for (let i = 0; i < 2; i++) {
      app.instance.renders++;
      await app.settle();
    }
    const ul = app.container.querySelector("ul") as HTMLElement;
    expect(Array.from(ul.children, (li) => li.id || li.className)).toEqual(["a", "c"]);
  });
});

/**
 * One attributes object handed to `__h` on every render and changed in between. The diff keeps an element's
 * attributes object as its record, so `__h` copies the one an app hands it: the record keeps what was
 * written, and the object stays the app's to change.
 */
describe("an attributes object reused across renders", () => {
  test("is written as it is now, with what it no longer holds taken away", async () => {
    class Reused extends Component {
      @state step = 0;
      readonly attributes: Record<string, unknown> = { id: "a", title: "t" };
      render() {
        this.attributes.id = this.step === 0 ? "a" : "b";
        if (this.step > 0) delete this.attributes.title;
        return <div>{__h("span", this.attributes as never, "x")}</div>;
      }
    }
    const app = await getDOM<Reused>(<Reused />);
    await app.settle();
    app.instance.step = 1;
    await app.settle();
    const span = app.container.querySelector("span") as HTMLElement;
    expect({ id: span.id, title: span.getAttribute("title") }).toEqual({ id: "b", title: null });
  });
});
