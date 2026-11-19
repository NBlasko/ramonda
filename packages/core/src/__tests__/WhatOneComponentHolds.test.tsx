import { afterEach, describe, expect, test } from "vitest";
import { Component, bootstrap, list, mounted, state, unmount } from "../index";
import { flushSync } from "../testing";
import { COMPONENT_RUNTIME, GLOBAL_RUNTIME } from "../core/runtime";
import { State } from "../reactivity/State";
import { attach, detach } from "../helpers/constants";
import { createContext } from "../base/Context";

/**
 * What a component instance holds, and what a list row does when it runs again.
 *
 * Measured in Chrome after creating 1,000 rows of five components each (js-framework-benchmark, the
 * same DOM with and without components): 1,602 B and about 42 heap objects per component. What these
 * tests pin is the part of that the framework made for nothing — and that a select of one row in a
 * thousand subscribed every row again. Each is the internal fact itself, read on purpose: an object
 * that is not allocated, or a subscription that is not written, does nothing anyone can see.
 */

const containers: HTMLElement[] = [];

function mount(node: unknown): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  containers.push(container);
  bootstrap(node as never, container);
  flushSync();
  return container;
}

afterEach(() => {
  for (const container of containers.splice(0)) {
    unmount(container);
    container.remove();
  }
});

describe("a component runtime", () => {
  /**
   * Every field it will hold is there when it is made. A field added later gives the object a new
   * hidden class, and V8 keeps the fields added after birth in a separate property array — 3.4 of
   * them per component, measured.
   */
  test("has the same fields, in the same order, from construction to teardown", () => {
    const born: string[][] = [];
    const leaves: Leaf[] = [];
    class Leaf extends Component<{ n: number }> {
      constructor(...args: ConstructorParameters<typeof Component<{ n: number }>>) {
        super(...args);
        born.push(Object.keys(this[COMPONENT_RUNTIME]));
        leaves.push(this);
      }
      render() {
        return <b>{this.props.n}</b>;
      }
    }
    class Page extends Component {
      @state n = 1;
      render() {
        return (
          <div>
            <Leaf n={this.n} />
          </div>
        );
      }
    }
    const container = mount(<Page />);
    const leaf = leaves[0];
    const keys = () => Object.keys(leaf[COMPONENT_RUNTIME]);

    expect(keys()).toEqual(born[0]);

    const page = leaf[COMPONENT_RUNTIME].parent as Page;
    page.n = 2;
    flushSync();
    expect(container.textContent).toBe("2");
    expect(keys()).toEqual(born[0]);

    unmount(container);
    expect(leaf[COMPONENT_RUNTIME].isDestroyed).toBe(true);
    expect(keys()).toEqual(born[0]);
  });

  const LISTS = [
    "mounts",
    "creates",
    "destroys",
    "watchProps",
    "deferHydrations",
    "effects",
    "updates",
    "clearReactives",
  ] as const;

  /**
   * Eight lists, and most components put nothing in any of them: they share one empty list until
   * something is added. Frozen, so a `push` past `addTo` throws rather than reaching every component.
   */
  test("shares one empty list until something is added, and that one cannot be pushed onto", () => {
    const made: Component[] = [];
    class Plain extends Component {
      @state n = 0;
      constructor(...args: ConstructorParameters<typeof Component>) {
        super(...args);
        made.push(this);
      }
      render() {
        return <i>{this.n}</i>;
      }
    }
    class Ready extends Plain {
      @mounted ready(): void {}
    }
    mount(
      <div>
        <Plain />
        <Plain />
        <Ready />
      </div>,
    );
    const [a, b, ready] = made;

    for (const name of LISTS) {
      expect(a[GLOBAL_RUNTIME][name], name).toBe(b[GLOBAL_RUNTIME][name]);
      expect(a[GLOBAL_RUNTIME][name], name).toHaveLength(0);
      expect(Object.isFrozen(a[GLOBAL_RUNTIME][name]), name).toBe(true);
    }

    // The one with a `@mounted` has a list of its own for it, and shares the rest.
    expect(ready[GLOBAL_RUNTIME].mounts).not.toBe(a[GLOBAL_RUNTIME].mounts);
    expect(ready[GLOBAL_RUNTIME].mounts).toHaveLength(1);
    for (const name of LISTS.filter((name) => name !== "mounts")) {
      expect(ready[GLOBAL_RUNTIME][name], name).toBe(a[GLOBAL_RUNTIME][name]);
    }

    expect(() => (a[GLOBAL_RUNTIME].effects as unknown[]).push(1)).toThrow(TypeError);
  });
});

describe("a component's props", () => {
  /**
   * One handler serves every component's props. What each component has of its own is the proxy and
   * a target holding the component in a private field — so the proxy still looks like an empty plain
   * object to every reflection, as it did when the target was `{}`.
   */
  test("look like an empty plain object, and read each component's own values", () => {
    const made: Shows[] = [];
    class Shows extends Component<{ label: string }> {
      constructor(...args: ConstructorParameters<typeof Component<{ label: string }>>) {
        super(...args);
        made.push(this);
      }
      render() {
        return <p>{this.props.label}</p>;
      }
    }
    const container = mount(
      <div>
        <Shows label="a" />
        <Shows label="b" />
      </div>,
    );
    expect(container.textContent).toBe("ab");

    const props = made[0].props;
    expect(Object.keys(props)).toEqual([]);
    expect(Reflect.ownKeys(props)).toEqual([]);
    expect("label" in props).toBe(false);
    expect(Object.getPrototypeOf(props)).toBe(Object.prototype);
    expect(made[0].props.label).toBe("a");
    expect(made[1].props.label).toBe("b");
    expect(() => {
      (props as { label: string }).label = "c";
    }).toThrow(/RMD004/);
  });
});

/** Counts reads of `childNodes` on every node while `run` runs. */
function childNodesReadsDuring(run: () => void): number {
  const descriptor = Object.getOwnPropertyDescriptor(Node.prototype, "childNodes");
  if (descriptor?.get === undefined) throw new Error("childNodes is not an accessor here");
  const read = descriptor.get;
  let reads = 0;
  Object.defineProperty(Node.prototype, "childNodes", {
    ...descriptor,
    get(this: Node) {
      reads++;
      return read.call(this);
    },
  });
  try {
    run();
  } finally {
    Object.defineProperty(Node.prototype, "childNodes", descriptor);
  }
  return reads;
}

interface Item {
  id: number;
  label: string;
}

const items = (from: number, count: number): Item[] =>
  Array.from({ length: count }, (_, i) => ({ id: from + i, label: `row ${from + i}` }));

describe("rows built of components", () => {
  /**
   * The framework walks an element's children by sibling. A browser keeps the `NodeList` a
   * `childNodes` read creates on the element for as long as it lives — two per row, measured.
   */
  test("are built, updated, removed and appended without reading childNodes", () => {
    class Cell extends Component<{ text: string }> {
      render() {
        return <td>{this.props.text}</td>;
      }
    }
    class Icon extends Component {
      render() {
        return <span class="icon" />;
      }
    }
    class RowView extends Component<{ item: Item; selected: boolean }> {
      render() {
        return (
          <tr class={this.props.selected ? "danger" : ""}>
            <Cell text={String(this.props.item.id)} />
            <Cell text={this.props.item.label} />
            <td>
              <a>
                <Icon />
              </a>
            </td>
          </tr>
        );
      }
    }
    let table: Table | undefined;
    class Table extends Component {
      @state rows = items(1, 10);
      @state selected = 0;
      constructor(...args: ConstructorParameters<typeof Component>) {
        super(...args);
        table = this;
      }
      row(item: Item) {
        return <RowView key={item.id} item={item} selected={this.selected === item.id} />;
      }
      render() {
        return (
          <table>
            <tbody>{list(this.rows, this.row)}</tbody>
          </table>
        );
      }
    }

    let container: HTMLElement | undefined;
    const reads = childNodesReadsDuring(() => {
      container = mount(<Table />);
      table!.selected = 3;
      flushSync();
      table!.rows = table!.rows.filter((row) => row.id !== 5);
      flushSync();
      table!.rows = [...table!.rows, ...items(11, 3)];
      flushSync();
    });

    expect(container!.querySelectorAll("tr")).toHaveLength(12);
    expect(container!.querySelectorAll(".icon")).toHaveLength(12);
    expect(container!.querySelector(".danger")?.textContent).toBe("3row 3");
    expect(reads).toBe(0);
  });
});

/** Counts subscriptions written to and removed from every signal while `run` runs. */
function subscriptionsDuring(run: () => void): { attached: number; detached: number } {
  const proto = State.prototype as unknown as Record<symbol, (...args: unknown[]) => void>;
  const realAttach = proto[attach];
  const realDetach = proto[detach];
  const counts = { attached: 0, detached: 0 };
  proto[attach] = function (this: unknown, ...args: unknown[]) {
    counts.attached++;
    return realAttach.apply(this, args);
  };
  proto[detach] = function (this: unknown, ...args: unknown[]) {
    counts.detached++;
    return realDetach.apply(this, args);
  };
  try {
    run();
  } finally {
    proto[attach] = realAttach;
    proto[detach] = realDetach;
  }
  return counts;
}

describe("a list row that runs again", () => {
  /**
   * Every row reads `this.selected`, so a select runs all of them — and each reads the same signal
   * it read last time. It stays subscribed: nothing is detached, nothing attached again.
   */
  test("reading what it read last time, writes no subscription", () => {
    let table: Table | undefined;
    let runs = 0;
    class Table extends Component {
      @state rows = items(1, 100);
      @state selected = 0;
      constructor(...args: ConstructorParameters<typeof Component>) {
        super(...args);
        table = this;
      }
      row(item: Item) {
        runs++;
        return (
          <tr key={item.id} class={this.selected === item.id ? "danger" : ""}>
            <td>{item.label}</td>
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
    const container = mount(<Table />);

    for (const id of [5, 7]) {
      runs = 0;
      const counts = subscriptionsDuring(() => {
        table!.selected = id;
        flushSync();
      });
      expect(container.querySelectorAll(".danger")).toHaveLength(1);
      expect(container.querySelector(".danger")?.textContent).toBe(`row ${id}`);
      // Every row ran — all of them read `selected` — and none of them touched a subscription.
      expect(runs).toBeGreaterThanOrEqual(100);
      expect(counts).toEqual({ attached: 0, detached: 0 });
    }
  });

  /**
   * A row that stops reading a signal is released from it: the row that showed the detail before a
   * select does not run again when the detail changes after it.
   */
  test("that stops reading a signal is released from it", () => {
    let table: Table | undefined;
    const ran: number[] = [];
    class Table extends Component {
      @state rows = items(1, 5);
      @state selected = 2;
      @state detail = "first";
      constructor(...args: ConstructorParameters<typeof Component>) {
        super(...args);
        table = this;
      }
      row(item: Item) {
        ran.push(item.id);
        return <li key={item.id}>{this.selected === item.id ? this.detail : item.label}</li>;
      }
      render() {
        return <ul>{list(this.rows, this.row)}</ul>;
      }
    }
    const container = mount(<Table />);
    expect(container.textContent).toBe("row 1firstrow 3row 4row 5");

    table!.selected = 4;
    flushSync();
    expect(container.textContent).toBe("row 1row 2row 3firstrow 5");

    ran.length = 0;
    table!.detail = "second";
    flushSync();
    expect(container.textContent).toBe("row 1row 2row 3secondrow 5");
    expect(ran).toEqual([4]);
  });

  /**
   * A row whose callback throws is left subscribed to nothing — what it read last time is released,
   * and what it read before throwing is not taken up.
   */
  test("that throws is released from everything it read", () => {
    let table: Table | undefined;
    class Table extends Component {
      @state rows = items(1, 3);
      @state selected = 0;
      @state broken = false;
      constructor(...args: ConstructorParameters<typeof Component>) {
        super(...args);
        table = this;
      }
      row(item: Item) {
        const selected = this.selected === item.id;
        if (item.id === 2 && this.broken) throw new Error("row 2 broke");
        return <li key={item.id}>{selected ? "*" : item.label}</li>;
      }
      render() {
        return <ul>{list(this.rows, this.row)}</ul>;
      }
    }
    mount(<Table />);

    // Row 2 read `selected` and `broken` last time; this run reads both again and throws.
    const counts = subscriptionsDuring(() => {
      table!.broken = true;
      expect(() => flushSync()).toThrow("row 2 broke");
    });
    expect(counts.attached).toBe(0);
    expect(counts.detached).toBe(2);
  });
});

describe("a component's context", () => {
  /**
   * A component reads its parent's context object until it publishes on it. An own object for every
   * component made each one with a child a PROTOTYPE — 1.4 hidden classes and a prototype record per
   * component, measured.
   */
  test("is its parent's object while it publishes nothing", () => {
    const made: Component[] = [];
    class Leaf extends Component {
      constructor(...args: ConstructorParameters<typeof Component>) {
        super(...args);
        made.push(this);
      }
      render() {
        return <i />;
      }
    }
    class Middle extends Component {
      constructor(...args: ConstructorParameters<typeof Component>) {
        super(...args);
        made.push(this);
      }
      render() {
        return (
          <b>
            <Leaf />
          </b>
        );
      }
    }
    class Top extends Component {
      constructor(...args: ConstructorParameters<typeof Component>) {
        super(...args);
        made.push(this);
      }
      render() {
        return (
          <div>
            <Middle />
            <Leaf />
          </div>
        );
      }
    }
    mount(<Top />);
    const [top, ...below] = made;
    expect(below).toHaveLength(3);
    for (const one of below) expect(one[GLOBAL_RUNTIME].context).toBe(top[GLOBAL_RUNTIME].context);
  });

  test("is an object of its own once it provides, inheriting its parent's, and its children read that", () => {
    const [ThemeProvider, ThemeConsumer] = createContext({ theme: "dark" }, { label: "Theme" });
    const made: Component[] = [];
    class Reader extends Component {
      theme = this.use(ThemeConsumer);
      constructor(...args: ConstructorParameters<typeof Component>) {
        super(...args);
        made.push(this);
      }
      render() {
        return <i>{this.theme.theme}</i>;
      }
    }
    class Gives extends Component {
      provider = this.use(ThemeProvider, () => ({ theme: "light" }));
      constructor(...args: ConstructorParameters<typeof Component>) {
        super(...args);
        made.push(this);
      }
      render() {
        return <Reader />;
      }
    }
    class Top extends Component {
      constructor(...args: ConstructorParameters<typeof Component>) {
        super(...args);
        made.push(this);
      }
      render() {
        return (
          <div>
            <Gives />
          </div>
        );
      }
    }
    const container = mount(<Top />);
    const [top, gives, reader] = made;
    expect(container.textContent).toBe("light");
    expect(gives[GLOBAL_RUNTIME].context).not.toBe(top[GLOBAL_RUNTIME].context);
    expect(Object.getPrototypeOf(gives[GLOBAL_RUNTIME].context)).toBe(top[GLOBAL_RUNTIME].context);
    expect(reader[GLOBAL_RUNTIME].context).toBe(gives[GLOBAL_RUNTIME].context);
  });

  /**
   * A provides, B publishes nothing, and C is mounted later, under a condition: C looks up when it is
   * made, through B's object — which is A's — and finds A's value.
   */
  test("reaches a component mounted later, through a parent that provides nothing", () => {
    const [ThemeProvider, ThemeConsumer] = createContext({ theme: "dark" }, { label: "Theme" });
    class C extends Component {
      theme = this.use(ThemeConsumer);
      render() {
        return <i>{this.theme.theme}</i>;
      }
    }
    let b: B | undefined;
    class B extends Component {
      @state open = false;
      constructor(...args: ConstructorParameters<typeof Component>) {
        super(...args);
        b = this;
      }
      render() {
        return <p>{this.open ? <C /> : null}</p>;
      }
    }
    class A extends Component {
      provider = this.use(ThemeProvider, () => ({ theme: "light" }));
      render() {
        return <B />;
      }
    }
    const container = mount(<A />);
    expect(container.textContent).toBe("");
    b!.open = true;
    flushSync();
    expect(container.textContent).toBe("light");
  });

  test("a sibling's publish is not seen beside it", () => {
    const [ThemeProvider, ThemeConsumer] = createContext({ theme: "dark" }, { label: "Theme" });
    class Gives extends Component {
      provider = this.use(ThemeProvider, () => ({ theme: "light" }));
      render() {
        return <i>given</i>;
      }
    }
    class Beside extends Component {
      theme = this.use(ThemeConsumer);
      render() {
        return <i>{this.theme.theme}</i>;
      }
    }
    const container = mount(
      <div>
        <Gives />
        <Beside />
      </div>,
    );
    expect(container.textContent).toBe("givendark");
  });

  /**
   * The same context provided by a parent and again by its child is nesting, not a second Provider on
   * one component: the child reads its parent's object, which has the key as its OWN, until the child
   * publishes on an object of its own.
   */
  test("provided again below is nesting, and the inner value is read below it", () => {
    const [ThemeProvider, ThemeConsumer] = createContext({ theme: "dark" }, { label: "Theme" });
    class Reader extends Component {
      theme = this.use(ThemeConsumer);
      render() {
        return <i>{this.theme.theme}</i>;
      }
    }
    class Inner extends Component {
      provider = this.use(ThemeProvider, () => ({ theme: "inner" }));
      render() {
        return <Reader />;
      }
    }
    class Outer extends Component {
      provider = this.use(ThemeProvider, () => ({ theme: "outer" }));
      render() {
        return (
          <div>
            <Reader />
            <Inner />
          </div>
        );
      }
    }
    const container = mount(<Outer />);
    expect(container.textContent).toBe("outerinner");
  });
});

describe("a first render", () => {
  /**
   * Every node of a first render is new, so nothing is in order to keep: they go in, in order, and the
   * walk that keeps what is already in place — and protects the focus while it moves things — is not
   * taken. It reads `document.activeElement` before it moves anything; a first render reads it never.
   */
  test("puts every node in, in order, without the walk that keeps nodes in place", () => {
    const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, "activeElement");
    if (descriptor?.get === undefined) throw new Error("activeElement is not an accessor here");
    const read = descriptor.get;
    let reads = 0;
    Object.defineProperty(Document.prototype, "activeElement", {
      ...descriptor,
      get(this: Document) {
        reads++;
        return read.call(this);
      },
    });
    class Cell extends Component<{ text: string }> {
      render() {
        return <td>{this.props.text}</td>;
      }
    }
    let container: HTMLElement | undefined;
    try {
      container = mount(
        <table>
          <tbody>
            <tr>
              <Cell text="a" />
              <Cell text="b" />
              <Cell text="c" />
            </tr>
          </tbody>
        </table>,
      );
    } finally {
      Object.defineProperty(Document.prototype, "activeElement", descriptor);
    }
    expect(container.querySelector("tr")?.textContent).toBe("abc");
    expect(reads).toBe(0);
  });
});
