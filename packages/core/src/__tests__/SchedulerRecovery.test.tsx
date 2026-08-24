import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { getDOM, instanceOf } from "../test/setup";
import { Component, state, createSubscriptionDecorator } from "../index";
import { reactivityScope } from "../reactivity/tracker";

/**
 * What happens to the REST of the app after an error nobody caught.
 *
 * `ErrorPropagation.test.tsx` covers where an error goes — which boundary sees
 * it, and that it is rethrown when there is none. This file covers what it
 * leaves behind, which is a different question and was the unasked one: every
 * test there asserted the throw and then stopped, so a scheduler that never
 * recovered from it passed the whole suite.
 *
 * The failure this guards against has no symptom. Nothing is logged, nothing is
 * thrown a second time, the DOM keeps whatever it had — the app simply stops
 * responding to state, everywhere, forever.
 */
describe("the scheduler survives an uncaught error", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    reactivityScope.currentEffect = null;
  });

  class Counter extends Component<{ id?: string }> {
    @state n = 0;
    render() {
      return (
        <div>
          <span id={this.props.id}>{this.n}</span>
        </div>
      );
    }
  }

  class Exploder extends Component {
    @state n = 0;
    render() {
      if (this.n > 0) throw new Error("render-boom");
      return (
        <div>
          <span id="exploder">safe</span>
        </div>
      );
    }
  }

  class App extends Component {
    render() {
      return (
        <div>
          <div>
            <Exploder />
            <Counter id="queued" />
            <Counter id="later" />
          </div>
        </div>
      );
    }
  }

  // The component whose markup holds `#id`, asked of the record — a node points at no component.
  const componentFor = (container: HTMLElement, id: string) =>
    instanceOf<any>(container.querySelector(`#${id}`));

  test("a component that went dirty in the SAME drain still renders", async () => {
    const app = await getDOM<App>(<App />);
    const queued = componentFor(app.container, "queued") as Counter;
    const exploder = componentFor(app.container, "exploder") as Exploder;

    // Order matters: the queue is popped from the end, so marking the counter
    // FIRST puts the exploder ahead of it — it throws before the counter builds.
    queued.n = 42;
    exploder.n = 1;

    expect(() => app.settle()).toThrow("render-boom");

    // The pending update is not lost, only deferred to the drain that the failed
    // one now schedules in its place.
    await app.settle();
    expect(app.container.querySelector("#queued")!.textContent).toBe("42");
  });

  test("a component that goes dirty AFTERWARDS still renders", async () => {
    const app = await getDOM<App>(<App />);
    const later = componentFor(app.container, "later") as Counter;
    const exploder = componentFor(app.container, "exploder") as Exploder;

    exploder.n = 1;
    expect(() => app.settle()).toThrow("render-boom");

    // Nothing to do with the failure, and not even queued when it happened.
    // This is the one that proves the whole app was dead, not just the subtree:
    // `addTaskToQueue` skips the microtask when the queue is non-empty, so a
    // queue left behind by a throw silenced every future update in the process.
    later.n = 7;
    await app.settle();
    expect(app.container.querySelector("#later")!.textContent).toBe("7");
  });

  test("the app keeps working across repeated failures", async () => {
    const app = await getDOM<App>(<App />);
    const later = componentFor(app.container, "later") as Counter;
    const exploder = componentFor(app.container, "exploder") as Exploder;

    for (let i = 1; i <= 3; i++) {
      exploder.n = i;
      expect(() => app.settle()).toThrow("render-boom");

      later.n = i * 10;
      await app.settle();
      expect(app.container.querySelector("#later")!.textContent).toBe(String(i * 10));
    }
  });
});

describe("a throwing effect does not corrupt the tracking scope", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  const onExplodingStore = createSubscriptionDecorator("onExplodingStore", () => {
    throw new Error("subscribe-boom");
  });

  test("currentEffect is cleared, so unrelated reads are not captured", async () => {
    class Boom extends Component {
      @state n = 0;
      @onExplodingStore()
      whatever() {}
      render() {
        return (
          <div>
            <span>{this.n}</span>
          </div>
        );
      }
    }

    await expect(getDOM<Boom>(<Boom />)).rejects.toThrow("subscribe-boom");

    /**
     * Left set, this is not a leak in the failing component — it is a leak in
     * every other one. `State.get()` records into `currentEffect.deps`, so a
     * dangling scope makes every signal read anywhere in the app accumulate on a
     * dead effect, holding it alive along with everything it captured.
     */
    expect(reactivityScope.currentEffect).toBeNull();
  });
});
