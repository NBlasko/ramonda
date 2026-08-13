import { bootstrap, __h, hydrateRoot } from "@ramonda/core";
import type { RamondaNode, VNode } from "@ramonda/core";
import { rerenderRoot, getComponentInstance } from "@ramonda/core/testing";
import {
  getQueriesForElement,
  prettyDOM,
  type BoundFunctions,
  type queries as defaultQueries,
} from "@testing-library/dom";
import { act } from "./act";
import { trackMountedTree, unmountTracked } from "./cleanup";

/**
 * A component class usable as a wrapper: it renders whatever it is given.
 *
 * Stated structurally rather than as `typeof Component`, so a wrapper declared
 * with its own props type still fits without the caller writing a cast.
 */
export type WrapperComponent = {
  new (...args: never[]): { render(): RamondaNode };
  readonly __isComponent: true;
};

export interface RenderOptions {
  /**
   * Render into this element instead of a fresh `<div>`. It is not removed on
   * cleanup — you supplied it, so it stays yours.
   */
  container?: HTMLElement;
  /**
   * Where a created container is appended, and what queries are bound to.
   * Defaults to `document.body`. Point it at a custom root when the thing under
   * test renders somewhere outside its own container.
   */
  baseElement?: HTMLElement;
  /**
   * A component to wrap the tree in — a context provider, a router shell,
   * anything the component under test needs above it. It receives the rendered
   * node as its children.
   */
  wrapper?: WrapperComponent;
  /**
   * Adopt server-rendered markup instead of building the DOM from scratch.
   *
   * - `true` hydrates whatever is already in `container` (pass one).
   * - **A string** is that markup: it is written into the container first, so a
   *   test can hand over `await renderToString(<App />)` and let the harness own
   *   the container — which means automatic cleanup covers it.
   *
   * The string form is the one to reach for. Hydration tests are exactly where a
   * leaked tree hurts most: whatever the server rendered stays live and the next
   * test hydrates on top of it.
   */
  hydrate?: boolean | string;
}

export interface RenderResult<T = unknown> extends BoundFunctions<typeof defaultQueries> {
  /** The element the tree was rendered into. */
  container: HTMLElement;
  /** What the queries are bound to — `document.body` unless overridden. */
  baseElement: HTMLElement;
  /**
   * The root component's instance, so a test can read and write its `@state`
   * directly. In Ramonda that is the normal way to drive a component: state is a
   * field, not something only an event can reach.
   *
   * `undefined` when the root is a plain element rather than a component, or
   * when a `wrapper` is used — then the instance found at the root is the
   * wrapper's.
   */
  instance: T;
  /**
   * Renders new JSX into the same container, DIFFING against what is there.
   *
   * The instance survives, its `@state` survives, `@created` does not run again
   * and `@watchProp` fires — the same thing that happens when a real parent
   * re-renders a child with new props. This is how to test prop reactivity.
   */
  rerender(ui: VNode): void;
  /** Tears the tree down, running `@destroyed` and every cleanup. */
  unmount(): void;
  /** The container's current content, detached — useful for snapshots. */
  asFragment(): DocumentFragment;
  /** Prints an element (the container by default) as formatted HTML. */
  debug(element?: Element | Element[]): void;
  /** Allows `using result = render(<App />)` where the runtime supports it. */
  [Symbol.dispose](): void;
}

/**
 * Mounts a component and hands back the DOM plus everything needed to drive it.
 *
 * ```ts
 * const { getByText, instance } = render(<Counter start={2} />);
 * expect(getByText("2")).toBeTruthy();
 *
 * act(() => { instance.count = 5; });
 * expect(getByText("5")).toBeTruthy();
 * ```
 *
 * Synchronous, and it stays that way: `bootstrap` builds the tree and runs
 * `@mounted` before it returns, and the `act` below commits anything those wrote.
 * There is nothing left to await, so a test does not have to guess how many
 * ticks a cascade needed — which is exactly what the harness this replaces got
 * wrong.
 *
 * Queries are bound to `baseElement` (`document.body`), matching the DOM Testing
 * Library convention, so anything rendered outside the container is still found.
 */
export function render<T = unknown>(ui: VNode, options: RenderOptions = {}): RenderResult<T> {
  const baseElement = options.baseElement ?? document.body;
  const containerIsOurs = options.container === undefined;

  const container = options.container ?? document.createElement("div");
  if (containerIsOurs) baseElement.appendChild(container);

  const tree = { container, baseElement, containerIsOurs };
  trackMountedTree(tree);

  // The one cast in this file, and it is confined here. `h` wants core's own
  // `ComponentClassKind`, which is not part of the public type surface; the
  // structural `WrapperComponent` above is what a user can actually write.
  const wrap = (node: VNode): VNode => (options.wrapper ? __h(options.wrapper as never, null, node) : node);

  if (typeof options.hydrate === "string") {
    container.innerHTML = options.hydrate;
  }

  act(() => {
    if (options.hydrate) {
      // ramonda-check-ignore the caller hands us the tree to mount, which is what this helper is for
      hydrateRoot(wrap(ui), container);
    } else {
      // ramonda-check-ignore the caller hands us the tree to mount, which is what this helper is for
      bootstrap(wrap(ui), container);
    }
  });

  const result: RenderResult<T> = {
    ...getQueriesForElement(baseElement),
    container,
    baseElement,
    instance: getComponentInstance(container.firstChild) as T,
    rerender(next: VNode) {
      act(() => {
        rerenderRoot(wrap(next), container);
      });
    },
    unmount() {
      unmountTracked(tree);
    },
    asFragment() {
      const template = document.createElement("template");
      template.innerHTML = container.innerHTML;
      return template.content;
    },
    debug(element) {
      const targets = element ? (Array.isArray(element) ? element : [element]) : [container];
      for (const target of targets) console.log(prettyDOM(target));
    },
    [Symbol.dispose]() {
      unmountTracked(tree);
    },
  };

  return result;
}
