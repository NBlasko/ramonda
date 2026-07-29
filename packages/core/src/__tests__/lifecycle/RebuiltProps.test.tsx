import { describe, test, expect } from "vitest";
import { getDOM } from "../../test/setup";
import { Component } from "../../base/Component";
import { Hook } from "../../base/Hook";
import { compute, state, watchProp } from "../../base/decorators";

/**
 * What a rebuilt reference in a hook's props bag actually costs downstream.
 *
 * Every prop is a signal and a signal compares by reference, so an array or a closure built
 * fresh in the props callback is a CHANGED prop. These four cases are the measured
 * consequences, and each is the reason something else exists: `@StableProps` and `stable()`
 * (so a value can be a value), RMD022 (so the rebuild is reported), and the note in
 * `/hooks/writing` about a bound method versus a closure.
 *
 * This file started as a measurement harness that wrote its numbers to a file. It is a test
 * now, with the numbers as assertions.
 */

describe("a rebuilt reference in a props bag", () => {
  test("makes @watchProp fire on every update render", async () => {
    let fired = 0;

    class Watcher extends Hook<{ items: readonly number[]; id: number }> {
      @watchProp((props) => props.items)
      onItems() {
        fired++;
      }
    }

    class Panel extends Component {
      @state unrelated = 0;
      w = this.use(Watcher, () => ({ items: [1, 2, 3], id: 7 }));

      render() {
        return <div>{String(this.unrelated)}</div>;
      }
    }

    const { instance, settle } = await getDOM<Panel>(<Panel />);
    instance.unrelated = 1;
    await settle();
    instance.unrelated = 2;
    await settle();

    // Twice for two update renders, though the contents never moved. A handler that fetches
    // or scrolls without a guard of its own does it on every render of somebody else's
    // component — which is why `Query.onKeyChanged` compares the key itself.
    expect(fired).toBe(2);
  });

  test("does not loop, because an in-build write folds into the same pass", async () => {
    let renders = 0;

    class Watcher extends Hook<{ items: readonly number[] }> {
      @state seen = 0;

      @watchProp((props) => props.items)
      onItems() {
        this.seen = this.seen + 1;
      }
    }

    class Panel extends Component {
      @state unrelated = 0;
      w = this.use(Watcher, () => ({ items: [1, 2, 3] }));

      render() {
        renders++;
        return <div>{`${this.w.seen}:${this.unrelated}`}</div>;
      }
    }

    const { instance, settle } = await getDOM<Panel>(<Panel />);
    expect(renders).toBe(1);

    instance.unrelated = 1;
    await settle();

    // One render for one change. watchProps run before the render phase, so the state they
    // write joins the render already in flight instead of scheduling another — which is
    // exactly what a POST-commit watcher could not do, and why that variant needs to compare
    // by value before it exists.
    expect(renders).toBe(2);
  });

  test("a closure that reads props WHEN CALLED keeps one identity, and the child stays put", async () => {
    let childRenders = 0;

    class Wrapper extends Hook<{ onSave: () => void }> {
      @compute get handler() {
        // Reads at call time, so the compute has no dependency and its answer never changes.
        return () => this.props.onSave();
      }
    }

    class Child extends Component<{ onSave: () => void }> {
      render() {
        childRenders++;
        return (
          <button type="button" onClick={this.props.onSave}>
            child
          </button>
        );
      }
    }

    class Panel extends Component {
      @state unrelated = 0;
      w = this.use(Wrapper, (self: Panel) => ({
        onSave: () => {
          self.unrelated = 0;
        },
      }));

      render() {
        return (
          <div>
            {String(this.unrelated)}
            <Child onSave={this.w.handler} />
          </div>
        );
      }
    }

    const { instance, settle } = await getDOM<Panel>(<Panel />);
    instance.unrelated = 1;
    await settle();
    instance.unrelated = 2;
    await settle();

    // Three renders of the parent, one of the child.
    expect(childRenders).toBe(1);
  });

  test("a compute that reads the prop WHILE COMPUTING re-renders the child every time", async () => {
    let childRenders = 0;
    let computeRuns = 0;

    class Wrapper extends Hook<{ onSave: () => void }> {
      @compute get handler() {
        computeRuns++;
        const fn = this.props.onSave; // read while computing → a dependency
        return () => fn();
      }
    }

    class Child extends Component<{ onSave: () => void }> {
      render() {
        childRenders++;
        return (
          <button type="button" onClick={this.props.onSave}>
            child
          </button>
        );
      }
    }

    class Panel extends Component {
      @state unrelated = 0;
      w = this.use(Wrapper, (self: Panel) => ({
        onSave: () => {
          self.unrelated = 0;
        },
      }));

      render() {
        return (
          <div>
            {String(this.unrelated)}
            <Child onSave={this.w.handler} />
          </div>
        );
      }
    }

    const { instance, settle } = await getDOM<Panel>(<Panel />);
    instance.unrelated = 1;
    await settle();
    instance.unrelated = 2;
    await settle();

    /**
     * The bag's closure is fresh each render, so the compute is invalidated, so the derived
     * function has a new identity, so `areStringRecordsEqual` sees a changed prop and the
     * child is queued. Three for three, with nothing having actually changed — and RMD020
     * cannot see it, because in a strict double render the compute is cached between the two
     * calls and both get the same value.
     */
    expect(computeRuns).toBe(3);
    expect(childRenders).toBe(3);
  });
});
