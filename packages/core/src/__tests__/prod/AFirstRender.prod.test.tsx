import { afterEach, describe, expect, test } from "vitest";
import { Component, bootstrap, unmount } from "../../index";
import { flushSync } from "../../testing";

/**
 * What a first render allocates, in a production build — a development build makes maps of its own for
 * its diagnostics, so the count below is only one number here. Runs with `__DEV__` false, in its own
 * process; see `vitest.prod.config.ts`.
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

describe("a first render", () => {
  test("__DEV__ is false in this run", () => {
    expect(__DEV__).toBe(false);
  });

  /**
   * Counts the `new Map` the diff makes while `run` runs — by where each is made, since the DOM under the
   * test (jsdom) and `bootstrap` make maps of their own.
   */
  function diffMapsMadeDuring(run: () => void): number {
    const Real = globalThis.Map;
    let made = 0;
    globalThis.Map = class extends Real<unknown, unknown> {
      constructor(entries?: Iterable<readonly [unknown, unknown]> | null) {
        super(entries);
        if ((new Error().stack ?? "").split("\n")[2]?.includes("/core/DiffAndMerge.")) made++;
      }
    } as MapConstructor;
    try {
      run();
    } finally {
      globalThis.Map = Real;
    }
    return made;
  }

  /**
   * A level with nothing before it has no regions to look up, so the diff makes no index of them, and
   * every node of it is new, so it makes no map of positions either. Measured in Chrome before: `new
   * Map` was 259 B allocated per component on create, most of it one empty index per level.
   */
  test("makes no Map in the diff", () => {
    let built = 0;
    class Leaf extends Component {
      constructor(...args: ConstructorParameters<typeof Component>) {
        super(...args);
        built++;
      }
      render() {
        return (
          <span>
            <b>leaf</b>
          </span>
        );
      }
    }
    class Branch extends Component {
      constructor(...args: ConstructorParameters<typeof Component>) {
        super(...args);
        built++;
      }
      render() {
        return (
          <li>
            <Leaf />
            <Leaf />
          </li>
        );
      }
    }
    class Tree extends Component {
      constructor(...args: ConstructorParameters<typeof Component>) {
        super(...args);
        built++;
      }
      render() {
        return (
          <ul>
            <Branch />
            <Branch />
            <Branch />
          </ul>
        );
      }
    }
    const made = diffMapsMadeDuring(() => mount(<Tree />));
    expect(built).toBe(10);
    expect(made).toBe(0);
  });
});
