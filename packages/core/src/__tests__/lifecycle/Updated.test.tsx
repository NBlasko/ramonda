import { describe, test, expect, beforeEach, vi } from "vitest";
import { getDOM } from "../../test/setup";
import { create, destroy, effect, mount, state, updated } from "../../base/decorators";
import { Component } from "../../base/Component";
import { Hook } from "../../base/Hook";
import { ErrorBoundary } from "../../base/ErrorBoundary";
import { renderToString } from "../../hydration/ssr";
import { resetDiagnostics } from "../../debug/diagnostics";

/**
 * `@updated` — the post-commit door.
 *
 * The contract these tests pin down: it runs after the DOM of an UPDATE is
 * committed, never for the first commit, children before parents, after this
 * drain's mounts and effects, never on the server, and never for a component that
 * was torn down in the same commit.
 *
 * What it deliberately does NOT have is dependency tracking, previous values, and a
 * cleanup contract — so most of what could be tested about an `@effect` does not
 * apply, which is the point of the decorator.
 */

let log: string[] = [];

beforeEach(() => {
  log = [];
});

describe("@updated", () => {
  test("does not run on the first commit — that is @mount's", async () => {
    class Panel extends Component {
      @state count = 0;

      @mount first() {
        log.push("mount");
      }

      @updated afterUpdate() {
        log.push("updated");
      }

      render() {
        log.push(`render:${this.count}`);
        return <div>{String(this.count)}</div>;
      }
    }

    const { instance, settle } = await getDOM<Panel>(<Panel />);

    // Mounting is not an update. Nothing to compare against, nothing to correct.
    expect(log).toEqual(["render:0", "mount"]);

    log = [];
    instance.count = 1;
    await settle();

    expect(log).toEqual(["render:1", "updated"]);
  });

  test("the DOM is already committed when it runs", async () => {
    // The whole reason it exists: reading the DOM at the write site is impossible,
    // because updates are batched through a microtask.
    let seenAtWriteSite = "";
    let seenInUpdated = "";

    class Panel extends Component {
      @state label = "before";

      @updated read() {
        seenInUpdated = this.element?.textContent ?? "";
      }

      private get element(): HTMLElement | null {
        return document.querySelector("#target");
      }

      change(next: string) {
        this.label = next;
        // Same synchronous turn as the write: the DOM has not been touched yet.
        seenAtWriteSite = this.element?.textContent ?? "";
      }

      render() {
        return <div id="target">{this.label}</div>;
      }
    }

    const { instance, settle } = await getDOM<Panel>(<Panel />);

    instance.change("after");
    expect(seenAtWriteSite).toBe("before");

    await settle();
    expect(seenInUpdated).toBe("after");
  });

  test("runs on every update, unconditionally", async () => {
    class Panel extends Component {
      @state count = 0;
      @state unrelated = 0;

      @updated tick() {
        log.push(`updated:${this.count}:${this.unrelated}`);
      }

      render() {
        return <div>{`${this.count}:${this.unrelated}`}</div>;
      }
    }

    const { instance, settle } = await getDOM<Panel>(<Panel />);

    instance.count = 1;
    await settle();
    instance.unrelated = 1;
    await settle();

    // No dependencies, so nothing is skipped — including the update that changed
    // something this method never reads. That is what "unconditional" means, and
    // guarding it is the body's job.
    expect(log).toEqual(["updated:1:0", "updated:1:1"]);
  });

  test("children run before parents", async () => {
    class Child extends Component<{ value: number }> {
      @updated afterUpdate() {
        log.push("child");
      }
      render() {
        return <span>{String(this.props.value)}</span>;
      }
    }

    class Parent extends Component {
      @state value = 0;

      @updated afterUpdate() {
        log.push("parent");
      }

      render() {
        return (
          <div>
            <Child value={this.value} />
          </div>
        );
      }
    }

    const { instance, settle } = await getDOM<Parent>(<Parent />);
    log = [];

    instance.value = 1;
    await settle();

    // A parent measuring its own subtree needs its children already updated.
    expect(log).toEqual(["child", "parent"]);
  });

  test("runs after the commit's mounts and effects", async () => {
    /**
     * The order is mounts → effects → `@updated`, and it follows from what the
     * decorator is for rather than from convenience. Mounts and effects live in the
     * post-commit flush, which is FIFO; `@updated` is a phase after it, deepest
     * component first. So a commit that mounts new children has them mounted — and
     * their listeners attached — before anything measures the subtree they are in.
     */
    class Child extends Component {
      @mount arrived() {
        log.push("child:mount");
      }
      render() {
        return <span>child</span>;
      }
    }

    class Panel extends Component {
      @state count = 0;

      @updated afterUpdate() {
        log.push("updated");
      }

      @effect subscribe() {
        log.push(`effect:${this.count}`);
      }

      render() {
        return <div>{this.count > 0 ? <Child /> : null}</div>;
      }
    }

    const { instance, settle } = await getDOM<Panel>(<Panel />);
    log = [];

    instance.count = 1;
    await settle();

    expect(log).toEqual(["child:mount", "effect:1", "updated"]);
  });

  test("several methods all run, in declaration order", async () => {
    class Panel extends Component {
      @state count = 0;

      @updated measure() {
        log.push("measure");
      }

      @updated position() {
        log.push("position");
      }

      render() {
        return <div>{String(this.count)}</div>;
      }
    }

    const { instance, settle } = await getDOM<Panel>(<Panel />);
    log = [];

    instance.count = 1;
    await settle();

    expect(log).toEqual(["measure", "position"]);
  });

  test("a guarded state write settles after exactly one more render", async () => {
    // The canonical use — measure, store, render with it — and the shape that keeps
    // it from looping. The guard is an idempotence check, not change detection.
    class Panel extends Component {
      @state height = 0;
      private measured = false;

      @updated measure() {
        log.push("updated");
        if (this.measured) return;
        this.measured = true;
        this.height = 42;
      }

      render() {
        log.push(`render:${this.height}`);
        return <div>{String(this.height)}</div>;
      }
    }

    const { instance, settle, container } = await getDOM<Panel>(<Panel />);
    log = [];

    instance.height = 1;
    await settle();

    // render(1) → updated writes 42 → render(42) → updated bails.
    expect(log).toEqual(["render:1", "updated", "render:42", "updated"]);
    expect(container.textContent).toContain("42");
  });

  test("does not run for a component destroyed in the same commit", async () => {
    class Child extends Component {
      @updated afterUpdate() {
        log.push("child:updated");
      }
      @destroy gone() {
        log.push("child:destroy");
      }
      render() {
        return <span>child</span>;
      }
    }

    class Parent extends Component {
      @state show = true;
      render() {
        return <div>{this.show ? <Child /> : null}</div>;
      }
    }

    const { instance, settle } = await getDOM<Parent>(<Parent />);
    log = [];

    instance.show = false;
    await settle();

    // The child's own update was queued by nothing — it was removed, not updated —
    // and the flush would skip it anyway, the same guarantee @mount has.
    expect(log).toEqual(["child:destroy"]);
  });

  test("does not run on the server", async () => {
    class Panel extends Component {
      @state count = 0;

      // Writes state on the server, so the render really does update during the
      // server drain — the only way a server render reaches the update path.
      @mount load() {
        this.count = 1;
      }

      @updated afterUpdate() {
        log.push("updated");
      }

      render() {
        return <div>{String(this.count)}</div>;
      }
    }

    const html = await renderToString(<Panel />);

    // The update happened — the markup proves it — and `@updated` stayed out of it.
    expect(html).toContain("1");
    expect(log).toEqual([]);
  });

  test("works on a hook, whose owner it follows", async () => {
    class Scroller extends Hook<{ selected: number }> {
      @updated afterUpdate() {
        log.push(`hook:${this.props.selected}`);
      }
    }

    class Panel extends Component {
      @state selected = 0;
      private scroller = this.use(Scroller, (self: Panel) => ({ selected: self.selected }));

      @updated afterUpdate() {
        log.push("component");
      }

      render() {
        void this.scroller;
        return <div>{String(this.selected)}</div>;
      }
    }

    const { instance, settle } = await getDOM<Panel>(<Panel />);
    log = [];

    instance.selected = 3;
    await settle();

    /**
     * A hook shares its owner's runtime, so its entry lands in the same list — and
     * the ORDER is the component's own methods first, then its hooks in `use()`
     * order. That is not a choice made here: a method decorator's initializer runs
     * at the start of construction, before the field initializers that call
     * `this.use()`. `@watchProp` behaves identically for the same reason.
     */
    expect(log).toEqual(["component", "hook:3"]);
  });

  test("a component without @updated queues nothing", async () => {
    // The perf claim, asserted through the only observable proxy: `@updated` on a
    // sibling class runs, and this one adds no post-commit work of its own. The
    // guard in `updateBuild` is a length check, so there is nothing to see beyond
    // "it still renders and nothing extra happens".
    class Plain extends Component {
      @state count = 0;
      @create init() {
        log.push("create");
      }
      render() {
        log.push(`render:${this.count}`);
        return <div>{String(this.count)}</div>;
      }
    }

    const { instance, settle } = await getDOM<Plain>(<Plain />);
    log = [];

    instance.count = 1;
    await settle();

    expect(log).toEqual(["render:1"]);
  });

  test("an unhandled throw propagates, exactly like a throwing @mount", async () => {
    // One decorator does not get its own error semantics: the throw goes through
    // `errorHandler`, which rethrows when no ErrorBoundary claims it.
    class Broken extends Component {
      @state value = 0;

      @updated boom(): void {
        throw new Error("measurement failed");
      }

      render() {
        return <span>{String(this.value)}</span>;
      }
    }

    const { instance, settle } = await getDOM<Broken>(<Broken />);
    instance.value = 1;

    // Thrown, not rejected: `settle` drains synchronously (`flushSync`), so the
    // throw escapes the call itself rather than arriving as a rejected promise.
    expect(() => settle()).toThrow("measurement failed");
  });

  test("an ErrorBoundary above it catches the throw", async () => {
    class Broken extends Component<{ value: number }> {
      @updated boom(): void {
        log.push("boom");
        throw new Error("measurement failed");
      }
      render() {
        return <span id="live">{String(this.props.value)}</span>;
      }
    }

    class Parent extends Component {
      @state value = 0;

      render() {
        return (
          <ErrorBoundary fallback={({ message }) => <span id="fallback">{message}</span>}>
            <Broken value={this.value} />
          </ErrorBoundary>
        );
      }
    }

    const { instance, settle, container } = await getDOM<Parent>(<Parent />);
    log = [];

    instance.value = 1;
    await settle();

    expect(log).toEqual(["boom"]);
    expect(container.querySelector("#fallback")?.textContent).toBe("measurement failed");
  });

  test("on a field it is reported, not silently ignored", () => {
    expect(() => {
      class Wrong extends Component {
        // @ts-expect-error — the decorator is for methods; this is the test.
        @updated notAMethod = 1;
        render() {
          return <div />;
        }
      }
      return Wrong;
    }).toThrow(/updated/);
  });
});

describe("an @updated that writes state unconditionally", () => {
  /**
   * The hazard `@updated` inherits from any post-render phase: writing state from it
   * schedules a render, whose `@updated` writes again. There is no prev/next to write an
   * `if` against, so this is the shape people will reach for by accident.
   *
   * It is already guarded, and by the guard that was there all along — `@updated` writes
   * state, state schedules a BUILD, and RMD009 counts builds per drain. Measured: it stops
   * at 50 and names the component. A dedicated `@updated` counter was drafted and then not
   * written, because it would have duplicated this.
   *
   * (The measurement that suggested otherwise had its own counter at 20, below the
   * threshold, so it stopped before the framework did and looked unguarded.)
   */
  test("is stopped by RMD009 rather than hanging", async () => {
    resetDiagnostics();
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
    const errors = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });

    let runs = 0;

    class Panel extends Component {
      @state tick = 0;

      @updated
      after() {
        runs++;
        this.tick = this.tick + 1;
      }

      render() {
        return <span>{String(this.tick)}</span>;
      }
    }

    try {
      const app = await getDOM<Panel>(<Panel />);
      app.instance.tick = 1;
      await app.settle();

      expect(runs).toBe(50);
      const reported = logs.join("\n");
      expect(reported).toContain("RMD009");
      expect(reported).toContain("<Panel />");
      expect(reported).toContain("stopped rendering it");
    } finally {
      spy.mockRestore();
      errors.mockRestore();
    }
  });
});
