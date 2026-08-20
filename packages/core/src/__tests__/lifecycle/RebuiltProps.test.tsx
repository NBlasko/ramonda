import { describe, test, expect } from "vitest";
import { getDOM } from "../../test/setup";
import { Component } from "../../base/Component";
import { Hook } from "../../base/Hook";
import { compute, state, watchProp } from "../../base/decorators";

/**
 * What a rebuilt reference in a hook's props bag actually costs downstream.
 *
 * Every prop is a signal and a signal compares by reference, so an array or a closure built fresh
 * in the props callback is a CHANGED prop — on the renders where the callback runs. Which renders
 * those are is the thing that changed: the callback is cached on the signals it reads, so an owner
 * rendering for an unrelated reason no longer calls it, and the rebuild no longer happens.
 *
 * The first and last tests here used to record the cost as 2-for-2 and 3-for-3. They record 0 and
 * 1 now, and they are kept rather than deleted because the number IS the point — the assertion is
 * what would notice if the cache were removed or stopped tracking something.
 *
 * The cost is not gone in general, only on the clean path. `StableHookProps.test.tsx` holds the
 * dirty-path case, where a rebuilt array inside a call that had to happen still wakes its signal
 * and `@StableProps` is still the answer.
 *
 * This file started as a measurement harness that wrote its numbers to a file. It is a test now,
 * with the numbers as assertions.
 */

describe("a rebuilt reference in a props bag", () => {
  test("no longer makes @watchProp fire on an unrelated render", async () => {
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

    /**
     * Zero. This used to fire twice, once per update render, though the contents never moved —
     * a handler that fetches or scrolls without a guard of its own did it on every render of
     * somebody else's component.
     *
     * The callback reads no signal, so the cache is never invalidated, so `items` is the same
     * array all three renders and the selector's value never moves. `Query.onKeyChanged` still
     * compares the key itself, and should: that guard covers the dirty path, where the callback
     * does run and the key IS rebuilt.
     */
    expect(fired).toBe(0);
  });

  test("still fires @watchProp when a signal the callback reads moves", async () => {
    const seen: string[] = [];

    class Watcher extends Hook<{ label: string }> {
      @watchProp((props) => props.label)
      onLabel([next]: [string]) {
        seen.push(next);
      }
    }

    class Panel extends Component {
      @state name = "a";
      w = this.use(Watcher, (self: Panel) => ({ label: self.name }));

      render() {
        return <div>{this.name}</div>;
      }
    }

    const { instance, settle } = await getDOM<Panel>(<Panel />);
    instance.name = "b";
    await settle();
    instance.name = "c";
    await settle();

    // The other half of the test above: skipping is not the same as never running. The cache
    // tracks `name`, so both moves reach the watcher, and neither is coalesced away.
    expect(seen).toEqual(["b", "c"]);
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

  test("a compute that reads the prop WHILE COMPUTING no longer re-renders the child", async () => {
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
     * This is the case the whole cache was worth building for, and it used to read 3 and 3.
     *
     * The chain was: the bag's closure is fresh each render → the compute reading it is
     * invalidated → the derived function has a new identity → `arePropsBagsEqual` sees a
     * changed prop → the child is queued. Three renders of a child, with nothing having actually
     * changed, from one `onSave` written the obvious way. RMD020 could not see it either, because
     * in a strict double render the compute is cached between the two calls and both get the same
     * value.
     *
     * The callback reads no signal — `self.unrelated` is assigned inside the closure, not read
     * while the bag is built — so it is called once, `onSave` keeps one identity, and the chain
     * never starts.
     */
    expect(computeRuns).toBe(1);
    expect(childRenders).toBe(1);
  });
});
