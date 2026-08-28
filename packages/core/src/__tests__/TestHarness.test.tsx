import { describe, test, expect } from "vitest";
import { getDOM } from "../test/setup";
import { Component, state, destroyed } from "../index";

/**
 * The harness itself. `getDOM` used to append a container to document.body and
 * never remove it, so every mount in a run stayed in the document with a LIVE
 * component tree behind it.
 *
 * Two consequences, and the second is the one that actually bit:
 *
 * 1. Destroyed nothing — @destroyed never ran, so timers, effects and window
 *    listeners from earlier tests stayed armed and could report into later ones.
 * 2. Duplicate ids. jsdom resolves even a SCOPED `container.querySelector("#x")`
 *    through a document-wide id index, so with the same id in several leaked
 *    containers it returned an EARLIER test's node — while `querySelectorAll`
 *    over the same subtree answered correctly. Tests passed alone, failed
 *    together.
 */

const containersInDocument = () => document.querySelectorAll('[id^="app"]').length;

describe("getDOM cleanup", () => {
  test("a mount leaves exactly one container in the document", async () => {
    class App extends Component {
      render() {
        return <p>one</p>;
      }
    }

    await getDOM(<App />);
    expect(containersInDocument()).toBe(1);
  });

  /**
   * The proof the previous test's container was really removed: if cleanup did
   * not run, this would see two. Order matters — it relies on the test above
   * having mounted.
   */
  test("the previous test's container is gone by the time this one runs", async () => {
    class App extends Component {
      render() {
        return <p>two</p>;
      }
    }

    expect(containersInDocument()).toBe(0); // before mounting
    await getDOM(<App />);
    expect(containersInDocument()).toBe(1);
  });

  test("cleanup unmounts the tree, so @destroyed runs", async () => {
    let wasDestroyed = false;

    class Leaky extends Component {
      @state value = 1;
      @destroyed teardown() {
        wasDestroyed = true;
      }
      render() {
        return (
          <div>
            <p>{String(this.value)}</p>
          </div>
        );
      }
    }

    const app = await getDOM(<Leaky />);
    expect(wasDestroyed).toBe(false);

    app.unmount();
    expect(wasDestroyed).toBe(true);
    expect(containersInDocument()).toBe(0);
  });

  /**
   * An explicit unmount followed by the automatic one must not tear the same
   * tree down twice — teardown deregisters the container.
   */
  test("unmounting explicitly then letting afterEach run is safe", async () => {
    let destroyCount = 0;

    class Counted extends Component {
      @destroyed teardown() {
        destroyCount++;
      }
      render() {
        return (
          <div>
            <p>x</p>
          </div>
        );
      }
    }

    const app = await getDOM(<Counted />);
    app.unmount();
    app.unmount(); // idempotent

    expect(destroyCount).toBe(1);
  });

  test("two containers alive at once do not share an id", async () => {
    class App extends Component {
      render() {
        return <p>x</p>;
      }
    }

    const first = await getDOM(<App />);
    const second = await getDOM(<App />);

    expect(first.container.id).not.toBe(second.container.id);
    expect(containersInDocument()).toBe(2);
  });
});
