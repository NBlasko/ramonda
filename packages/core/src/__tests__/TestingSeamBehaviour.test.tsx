import { afterEach, describe, expect, test } from "vitest";
import { Component, Host, state, created, mounted, bootstrap, unmount } from "../index";
import { flushSync, rerenderRoot, getComponentInstance } from "../testing";

/**
 * The three functions the testing seam exports do real work — `TestingSeam.test.ts`
 * pins their *names*, this pins their *behaviour*. Between them a harness has no
 * surprises: a synchronous flush, an in-place re-render that keeps the instance, and
 * a node → instance lookup.
 */

let container: HTMLElement | null = null;
function mountInto(vnode: Parameters<typeof bootstrap>[0]): HTMLElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  bootstrap(vnode, container);
  return container;
}
afterEach(() => {
  if (container) {
    unmount(container);
    container.remove();
    container = null;
  }
});

describe("flushSync", () => {
  test("applies a batched update immediately", () => {
    @Host("div")
    class Counter extends Component {
      @state n = 0;
      bump() {
        this.n++;
      }
      render() {
        return <span>{this.n}</span>;
      }
    }

    const el = mountInto(<Counter />);
    const host = el.firstElementChild!;
    const inst = getComponentInstance(host) as unknown as Counter;

    inst.bump();
    // The write is queued through a microtask, so the DOM is still a tick behind.
    expect(host.textContent).toBe("0");

    flushSync();
    expect(host.textContent).toBe("1");
  });
});

describe("rerenderRoot", () => {
  test("re-renders in place: same instance, @state survives, @created runs once", () => {
    let creates = 0;

    @Host("div")
    class Card extends Component<{ title: string }> {
      @state hits = 0;
      @created init() {
        creates++;
      }
      @mounted ready() {
        this.hits = 7;
      }
      render() {
        return (
          <span>
            {this.props.title}:{this.hits}
          </span>
        );
      }
    }

    const el = mountInto(<Card title="a" />);
    flushSync(); // settle the state write @mounted queued
    const host = el.firstElementChild!;
    const first = getComponentInstance(host);
    expect(host.textContent).toBe("a:7");

    rerenderRoot(<Card title="b" />, el);
    flushSync();

    // Same DOM node, same instance — the prop changed, the @state and the single
    // @created did not.
    expect(host.textContent).toBe("b:7");
    expect(getComponentInstance(el.firstElementChild)).toBe(first);
    expect(creates).toBe(1);
  });

  test("throws when the container was never rendered into", () => {
    @Host("div")
    class Card extends Component {
      render() {
        return <span>x</span>;
      }
    }

    const empty = document.createElement("div");
    expect(() => rerenderRoot(<Card />, empty)).toThrow(/empty container/i);
  });
});

describe("getComponentInstance", () => {
  test("returns the instance for a component's host node", () => {
    @Host("div")
    class Widget extends Component {
      render() {
        return <span>w</span>;
      }
    }

    const el = mountInto(<Widget />);
    const host = el.firstElementChild!;
    expect(getComponentInstance(host)).toBeInstanceOf(Widget);
  });

  test("returns undefined for nothing, or a node that is not a component host", () => {
    expect(getComponentInstance(null)).toBeUndefined();
    expect(getComponentInstance(undefined)).toBeUndefined();
    expect(getComponentInstance(document.createTextNode("plain"))).toBeUndefined();
  });
});
