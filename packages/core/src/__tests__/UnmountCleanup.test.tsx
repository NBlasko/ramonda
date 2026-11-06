import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { getDOM, findOne } from "../test/setup";
import { Component, state, destroyed, interval, createContext, list, createRef } from "../index";
import { effectLike } from "../test/effectLike";

const [Provider, Ctx] = createContext({ v: "a" });

/**
 * Teardown is a sequence of things the APP wrote — effect cleanups and
 * `@destroyed` bodies — and one throw used to abort all of it: the remaining
 * cleanups, the signal unsubscribes, the `isDestroyed` flag, and the caller's
 * `child.remove()`. A `@destroyed` that threw left the element on the page, still
 * rendered, with the component half alive.
 */
describe("unmount cleanup", () => {
  beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  test("a throwing @destroyed does not take the rest of teardown down", async () => {
    const ran: string[] = [];
    class Child extends Component {
      @state n = 0;
      @destroyed first() {
        ran.push("first");
        throw new Error("boom");
      }
      @destroyed second() {
        ran.push("second");
      }
      render() {
        return (
          <div>
            <span>{this.n}</span>
          </div>
        );
      }
    }
    class App extends Component {
      @state show = true;
      render() {
        return (
          <div>
            <div>{this.show ? <Child /> : null}</div>
          </div>
        );
      }
    }
    const app = await getDOM<App>(<App />);
    await app.settle();
    vi.spyOn(console, "error").mockImplementation(() => {});

    app.instance.show = false;
    await app.settle();

    // Destroys run in reverse, so the throwing one goes LAST — and everything
    // after it in the sweep used to be skipped.
    expect(ran).toEqual(["second", "first"]);
    // The measurable consequence: the element stayed on the page ("0").
    expect(app.container.textContent).toBe("");
  });

  test("a throwing effect cleanup does not skip @destroyed", async () => {
    const ran: string[] = [];
    class Child extends Component {
      @state n = 0;
      @interval(1000) tick() {
        this.n++;
      }
      @effectLike() bad() {
        ran.push("effect");
        return () => {
          throw new Error("cleanup boom");
        };
      }
      @destroyed after() {
        ran.push("destroy");
      }
      render() {
        return (
          <div>
            <span>{this.n}</span>
          </div>
        );
      }
    }
    class App extends Component {
      @state show = true;
      render() {
        return (
          <div>
            <div>{this.show ? <Child /> : null}</div>
          </div>
        );
      }
    }
    const app = await getDOM<App>(<App />);
    await app.settle();
    vi.spyOn(console, "error").mockImplementation(() => {});

    app.instance.show = false;
    await app.settle();

    // Effect cleanups run before @destroyed, so a throw there used to mean the
    // component's own teardown never happened at all.
    expect(ran).toContain("destroy");
    expect(app.container.textContent).toBe("");
  });

  test("a write after unmount schedules no render", async () => {
    let renders = 0;
    class Child extends Component {
      @state n = 0;
      render() {
        renders++;
        return (
          <div>
            <span>{this.n}</span>
          </div>
        );
      }
    }
    class App extends Component {
      @state show = true;
      render() {
        return (
          <div>
            <div>{this.show ? <Child /> : null}</div>
          </div>
        );
      }
    }
    const app = await getDOM<App>(<App />);
    await app.settle();
    const child = findOne<any>(app.container, "Child");
    app.instance.show = false;
    await app.settle();
    const before = renders;

    // The fetch that resolves after the user navigated away.
    child.n = 99;
    await app.settle();
    expect(renders).toBe(before);
  });

  test("an unmounted consumer stops listening to the provider", async () => {
    class Consumer extends Component {
      ctx = this.use(Ctx);
      render() {
        return (
          <div>
            <span>{this.ctx.v}</span>
          </div>
        );
      }
    }
    class App extends Component {
      @state v = "a";
      @state show = true;
      p = this.use(Provider, () => ({ v: this.v }));
      render() {
        return (
          <div>
            <div>{this.show ? <Consumer /> : null}</div>
          </div>
        );
      }
    }
    const app = await getDOM<App>(<App />);
    await app.settle();
    const sym = Object.getOwnPropertySymbols((app.instance as any).p).find((s) =>
      String(s).includes("hookRuntime"),
    ) as symbol;
    const sig: any = (app.instance as any).p[sym].propsSignals.get("v");
    const count = (x: any) => (x?._listeners ? x._listeners.size : x?._listener !== undefined ? 1 : 0);
    expect(count(sig)).toBe(2); // the consumer, plus the providing component

    app.instance.show = false;
    await app.settle();
    expect(count(sig)).toBe(1);
  });
});

/**
 * A row taken away is walked for what it holds — a ref, a block's record, a field — and the walk goes by
 * `firstChild` / `nextSibling`. Through `childNodes` it read a NodeList per node: measured in Chromium on
 * 1000 benchmark rows, 7.3 ms against 2.3, and on js-framework-benchmark's clear it was a third of the time.
 */
describe("what a removed row is walked through", () => {
  interface Row {
    readonly id: number;
  }

  class Table extends Component {
    @state rows: Row[] = Array.from({ length: 20 }, (_, i) => ({ id: i + 1 }));
    readonly field = createRef<HTMLInputElement>();
    row(row: Row) {
      return (
        <tr key={row.id}>
          <td>{row.id}</td>
          <td>
            <a>
              <span>x</span>
            </a>
          </td>
          {row.id === 3 ? (
            <td>
              <input aria-label="Third" ref={this.field} />
            </td>
          ) : null}
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

  test("by its siblings, never a NodeList, and what it held is let go", async () => {
    // The input in the third row holds a ref and is a field: both are let go by the walk.
    const app = await getDOM<Table>(<Table />);
    await app.settle();
    const held = app.instance.field.current;
    const descriptor = Object.getOwnPropertyDescriptor(Node.prototype, "childNodes") as PropertyDescriptor;
    let lists = 0;
    Object.defineProperty(Node.prototype, "childNodes", {
      ...descriptor,
      get(this: Node) {
        // Only inside a row: the table above them is diffed as well, which is another question.
        if ((this.nodeType === Node.ELEMENT_NODE ? (this as Element) : this.parentElement)?.closest("tr")) lists++;
        return descriptor.get?.call(this);
      },
    });
    try {
      app.instance.rows = [];
      await app.settle();
    } finally {
      Object.defineProperty(Node.prototype, "childNodes", descriptor);
    }
    expect({ held: held !== null, lists, after: app.instance.field.current }).toEqual({
      held: true,
      lists: 0,
      after: null,
    });
  });
});

/**
 * A node that takes itself out while the teardown walks past it — a ref's callback tearing down the widget
 * it held, and the widget's host with it — leaves the walk no next sibling to read. The siblings after it
 * are still let go.
 */
describe("a node that takes itself out while it is let go", () => {
  test("the siblings after it are let go too", async () => {
    class Widgets extends Component {
      @state shown = true;
      readonly first = createRef<HTMLElement>(this.torn);
      readonly second = createRef<HTMLElement>();
      torn(element: HTMLElement | null) {
        if (element === null) document.getElementById("first")?.remove();
      }
      render() {
        return (
          <div>
            {this.shown ? (
              <section>
                <p id="first" ref={this.first}>
                  1
                </p>
                <p id="second" ref={this.second}>
                  2
                </p>
              </section>
            ) : null}
          </div>
        );
      }
    }
    const app = await getDOM<Widgets>(<Widgets />);
    await app.settle();
    app.instance.shown = false;
    await app.settle();
    expect(app.instance.second.current).toBe(null);
  });

  test("a last node that takes itself out ends the walk", async () => {
    class Last extends Component {
      @state shown = true;
      readonly last = createRef<HTMLElement>(this.torn);
      torn(element: HTMLElement | null) {
        if (element === null) document.getElementById("last")?.remove();
      }
      render() {
        return (
          <div>
            {this.shown ? (
              <section id="rows">
                <p>1</p>
                <p id="last" ref={this.last}>
                  2
                </p>
              </section>
            ) : null}
          </div>
        );
      }
    }
    const app = await getDOM<Last>(<Last />);
    await app.settle();
    const section = app.container.querySelector("#rows");
    const descriptor = Object.getOwnPropertyDescriptor(Node.prototype, "firstChild") as PropertyDescriptor;
    let walks = 0;
    Object.defineProperty(Node.prototype, "firstChild", {
      ...descriptor,
      get(this: Node) {
        if (this === section) walks++;
        return descriptor.get?.call(this);
      },
    });
    try {
      app.instance.shown = false;
      await app.settle();
    } finally {
      Object.defineProperty(Node.prototype, "firstChild", descriptor);
    }
    expect(walks).toBe(1);
  });

  test("the siblings after two that a @destroyed took out together are let go too", async () => {
    const destroyedNames: string[] = [];
    class Widget extends Component {
      @destroyed
      gone() {
        // A widget taking its host and the overlay it put after it out of the page.
        document.getElementById("host")?.remove();
        document.getElementById("overlay")?.remove();
      }
      render() {
        return <em>w</em>;
      }
    }
    class Later extends Component {
      @destroyed
      gone() {
        destroyedNames.push("later");
      }
      render() {
        return <i>later</i>;
      }
    }
    class Page extends Component {
      @state shown = true;
      render() {
        return (
          <main>
            {this.shown ? (
              <section>
                <div id="host">
                  <Widget />
                </div>
                <div id="overlay" />
                <div>
                  <Later />
                </div>
              </section>
            ) : null}
          </main>
        );
      }
    }
    const app = await getDOM<Page>(<Page />);
    await app.settle();
    app.instance.shown = false;
    await app.settle();
    expect(destroyedNames).toEqual(["later"]);
  });

  test("the siblings after one that moved itself to the end are let go too", async () => {
    class Moving extends Component {
      @state shown = true;
      readonly first = createRef<HTMLElement>(this.moved);
      readonly second = createRef<HTMLElement>();
      moved(element: HTMLElement | null) {
        const first = document.getElementById("first");
        if (element === null && first !== null) first.parentNode?.appendChild(first);
      }
      render() {
        return (
          <div>
            {this.shown ? (
              <section>
                <p id="first" ref={this.first}>
                  1
                </p>
                <p id="second" ref={this.second}>
                  2
                </p>
              </section>
            ) : null}
          </div>
        );
      }
    }
    const app = await getDOM<Moving>(<Moving />);
    await app.settle();
    app.instance.shown = false;
    await app.settle();
    expect(app.instance.second.current).toBe(null);
  });
});
