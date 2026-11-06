import { describe, test, expect } from "vitest";
import { getDOM } from "../test/setup";
import { state } from "../base/decorators";
import { Component, list } from "../index";
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
