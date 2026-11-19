import { afterEach, describe, expect, test } from "vitest";
import { Component, bootstrap, mounted, state, unmount } from "../index";
import { flushSync } from "../testing";

/**
 * The queue a commit leaves for after the DOM is in: every component's `@mounted`, and its first
 * effects run — one entry at least for every component built.
 *
 * Creating 10,000 rows of five components queues 50,000 entries. Taken off the front one `shift()` at
 * a time, an array that long is moved whole on each take whenever V8 cannot trim it from the front:
 * measured in Chrome (js-framework-benchmark), the same build created 10,000 rows in about 800 ms or
 * about 3,900 ms of script, run to run. The flush walks the queue with a cursor instead.
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

describe("a flush of many mounts", () => {
  test("runs each once, children before their parent, without taking from the front of the queue", () => {
    const order: string[] = [];
    class Leaf extends Component<{ n: number }> {
      @mounted ready(): void {
        order.push(`leaf ${this.props.n}`);
      }
      render() {
        return <i>{this.props.n}</i>;
      }
    }
    class Page extends Component {
      @mounted ready(): void {
        order.push("page");
      }
      render() {
        return (
          <div>
            {Array.from({ length: 3000 }, (_, n) => (
              <Leaf key={n} n={n} />
            ))}
          </div>
        );
      }
    }

    const shift = Array.prototype.shift;
    let shifts = 0;
    Array.prototype.shift = function (this: unknown[]) {
      shifts++;
      return shift.call(this);
    };
    try {
      mount(<Page />);
    } finally {
      Array.prototype.shift = shift;
    }

    expect(order).toHaveLength(3001);
    expect(order.slice(0, 3)).toEqual(["leaf 0", "leaf 1", "leaf 2"]);
    expect(order[2999]).toBe("leaf 2999");
    expect(order[3000]).toBe("page");
    expect(shifts).toBe(0);
  });

  /**
   * A component torn down in the middle of the flush drops only its entries still waiting. Its
   * entries that already ran are behind the cursor: removed, they moved every later entry one place
   * closer, and the cursor stepped over the ones it had not run yet.
   */
  test("a component torn down while it runs drops only what is still waiting", () => {
    const order: string[] = [];
    const early = document.createElement("div");
    const late = document.createElement("div");
    document.body.append(early, late);
    containers.push(late);
    class First extends Component {
      @mounted ready(): void {
        order.push("first");
      }
      render() {
        return <i>first</i>;
      }
    }
    class Second extends Component {
      @mounted ready(): void {
        order.push("second");
        // Takes `First` away now: its entries have run, and they sit before this one in the queue.
        unmount(early);
      }
      render() {
        return <i>second</i>;
      }
    }
    class Third extends Component {
      @mounted ready(): void {
        order.push("third");
      }
      render() {
        return <i>third</i>;
      }
    }
    const shows: Shows[] = [];
    class Shows extends Component<{ late: boolean }> {
      @state on = false;
      constructor(...args: ConstructorParameters<typeof Component<{ late: boolean }>>) {
        super(...args);
        shows.push(this);
      }
      render() {
        if (!this.on) return <p />;
        return this.props.late ? (
          <p>
            <Second />
            <Third />
          </p>
        ) : (
          <p>
            <First />
          </p>
        );
      }
    }
    bootstrap(<Shows late />, late);
    bootstrap(<Shows late={false} />, early);

    // Both roots render in one drain, so what they build is in one flush — `early`'s entries first.
    shows[0].on = true;
    shows[1].on = true;
    flushSync();
    early.remove();

    expect(order).toEqual(["first", "second", "third"]);
    expect(early.textContent).toBe("");
    expect(late.textContent).toBe("secondthird");
  });
});
