import { describe, test, expect } from "vitest";
import { getDOM } from "../../test/setup";
import { Component, Hook, state, created, mounted, destroyed, unmount } from "../../index";
import { queuePostCommit, flushPostCommit } from "../../core/commit";
import { COMPONENT_RUNTIME } from "../../core/runtime";
import type { BaseComponent } from "../../types/vdom";
import { effectLike } from "../../test/effectLike";

/**
 * @mounted must mean "my element is in the document".
 *
 * It did not. `buildComponent` called it at the end of building a component, but
 * the host element is inserted by the CALLER after build returns — so @mounted ran
 * against a DOM its own element was not part of yet. Measured before the fix: a
 * `document.querySelector` inside @mounted found ZERO of its own element on a first
 * mount, and on a replacement found the OUTGOING instance's element instead.
 */

describe("@mounted runs after the DOM is committed", () => {
  test("a component's own element is in the document by @mounted", async () => {
    let seenAtCreate = -1;
    let seenAtMount = -1;

    class Probe extends Component {
      @created born() {
        seenAtCreate = document.querySelectorAll(".probe").length;
      }
      @mounted ready() {
        seenAtMount = document.querySelectorAll(".probe").length;
      }
      render() {
        return (
          <div className="probe">
            <span>p</span>
          </div>
        );
      }
    }

    class App extends Component {
      render() {
        return (
          <div>
            <Probe />
          </div>
        );
      }
    }

    await getDOM(<App />);

    // @created still runs during build, before insertion — that is what @created
    // is for, and it is why @mounted exists as a separate hook.
    expect(seenAtCreate).toBe(0);
    expect(seenAtMount).toBe(1);
  });

  test("a replacement's @mounted sees its own element, not the outgoing one", async () => {
    const seen: string[] = [];

    class Panel extends Component<{ n: number }> {
      @mounted ready() {
        seen.push(
          Array.from(document.querySelectorAll(".swap"))
            .map((e) => e.textContent)
            .join("|"),
        );
      }
      render() {
        return (
          <div className="swap">
            <span>{String(this.props.n)}</span>
          </div>
        );
      }
    }

    class App extends Component {
      @state n = 1;
      render() {
        return (
          <div>
            <Panel key={String(this.n)} n={this.n} />
          </div>
        );
      }
    }

    const app = await getDOM<App>(<App />);
    seen.length = 0;

    app.instance.n = 2;
    await app.settle();

    // Before the fix this read "1" — the element being replaced.
    expect(seen).toEqual(["2"]);
  });

  test("children still mount before their parents", async () => {
    const order: string[] = [];

    class Child extends Component {
      @mounted ready() {
        order.push("child");
      }
      render() {
        return <span>c</span>;
      }
    }
    class Parent extends Component {
      @mounted ready() {
        order.push("parent");
      }
      render() {
        return (
          <div>
            <Child />
          </div>
        );
      }
    }

    await getDOM(<Parent />);
    expect(order).toEqual(["child", "parent"]);
  });
});

/**
 * The hazard deferring introduces, and the reason the queue checks `isDestroyed`
 * per entry rather than filtering once up front: between queueing a @mounted and
 * flushing it, the component may already be gone. Running it then would fire a
 * lifecycle callback on a dead component AFTER its @destroyed had cleaned up — so
 * the cleanup could not undo whatever the mount did.
 */
describe("a destroyed component never mounts", () => {
  test("tearing the tree down from a @mounted skips the pending mounts", async () => {
    const ran: string[] = [];

    class Late extends Component {
      @mounted ready() {
        ran.push("late");
      }
      @destroyed gone() {
        ran.push("late:destroy");
      }
      render() {
        return <span>late</span>;
      }
    }

    class Early extends Component<{ container?: HTMLElement }> {
      @mounted ready() {
        ran.push("early");
        // Synchronously tears down the whole root, including the sibling whose
        // @mounted is still sitting in the queue behind this one.
        if (this.props.container) unmount(this.props.container);
      }
      render() {
        return <span>early</span>;
      }
    }

    const container = document.createElement("div");
    container.id = "app-teardown";
    document.body.appendChild(container);

    class App extends Component<{ container: HTMLElement }> {
      render() {
        return (
          <div>
            <Early container={this.props.container} />
            <Late />
          </div>
        );
      }
    }

    const { bootstrap } = await import("../../index");
    bootstrap(<App container={container} />, container);

    expect(ran).toContain("early");
    // Late was destroyed before its queued @mounted could run.
    expect(ran).not.toContain("late");
    container.remove();
  });

  /**
   * The guarantee stated directly against the queue, so it holds even if no
   * component-level scenario in this repo happens to reach it today.
   */
  test("the queue skips an entry whose component is already destroyed", () => {
    const ran: string[] = [];

    const alive = {
      [COMPONENT_RUNTIME]: { isDestroyed: false },
    } as unknown as BaseComponent;
    const dead = {
      [COMPONENT_RUNTIME]: { isDestroyed: true },
    } as unknown as BaseComponent;

    queuePostCommit(alive, () => ran.push("alive"));
    queuePostCommit(dead, () => ran.push("dead"));
    flushPostCommit();

    expect(ran).toEqual(["alive"]);
  });

  test("an entry destroyed by an earlier callback in the same flush is skipped", () => {
    const ran: string[] = [];

    const first = {
      [COMPONENT_RUNTIME]: { isDestroyed: false },
    } as unknown as BaseComponent;
    const second = {
      [COMPONENT_RUNTIME]: { isDestroyed: false },
    } as unknown as BaseComponent;

    queuePostCommit(first, () => {
      ran.push("first");
      // Exactly what a real teardown does to a component still in the queue.
      second[COMPONENT_RUNTIME].isDestroyed = true;
    });
    queuePostCommit(second, () => ran.push("second"));
    flushPostCommit();

    expect(ran).toEqual(["first"]);
  });
});

/**
 * Hooks share their OWNER's runtime (`new hook(runtime, …)` in `useCommon`), so a
 * hook's @created/@mounted/@destroyed and its effects land in the same arrays the
 * component's do. That means the post-commit deferral covers them without
 * knowing they exist — but "should follow" is not "does follow", and the
 * destroyed-component guard keys on the OWNER, which is the part most likely to
 * be wrong.
 */
describe("hooks take part in the same commit", () => {
  /**
   * The order here is the OWNER's callback before its hook's, for both @created
   * and @mounted — the opposite of the child-before-parent rule for components.
   * That falls out of registration order in the shared runtime arrays: the
   * owner's decorator initializers register while the class is constructed,
   * before the field initializer `tracker = this.use(Tracker)` has run.
   *
   * Pre-existing and unchanged by the deferral, which only moved WHEN the queue
   * is drained, never the order entries go into it. Asserted here so the next
   * change to the commit has to notice if it moves.
   */
  test("a hook's @mounted also sees the DOM, in the owner's commit", async () => {
    const order: string[] = [];
    let hookSaw = -1;

    class Tracker extends Hook {
      @created born() {
        order.push("hook:create");
      }
      @mounted ready() {
        order.push("hook:mount");
        hookSaw = document.querySelectorAll(".tracked").length;
      }
      @destroyed gone() {
        order.push("hook:destroy");
      }
    }

    class Owner extends Component {
      tracker = this.use(Tracker);
      @created born() {
        order.push("owner:create");
      }
      @mounted ready() {
        order.push("owner:mount");
      }
      render() {
        return (
          <div className="tracked">
            <span>o</span>
          </div>
        );
      }
    }

    await getDOM(<Owner />);

    // The point of the test: by @mounted time the owner's element is committed,
    // and a hook sees the same DOM its owner does.
    expect(hookSaw).toBe(1);
    expect(order).toEqual(["owner:create", "hook:create", "owner:mount", "hook:mount"]);
  });

  test("a hook effect still runs after the owner's @mounted", async () => {
    const order: string[] = [];

    class Watcher extends Hook {
      @state ticks = 0;
      @effectLike() track() {
        // Reading the signal is what registers the effect.
        void this.ticks;
        order.push("hook:effect");
      }
    }

    class Owner extends Component {
      watcher = this.use(Watcher);
      @mounted ready() {
        order.push("owner:mount");
      }
      render() {
        return <span>o</span>;
      }
    }

    await getDOM(<Owner />);
    expect(order).toEqual(["owner:mount", "hook:effect"]);
  });

  test("a replaced owner's hook @destroyed does not see the replacement", async () => {
    const seen: string[] = [];

    class Reporter extends Hook {
      @destroyed gone() {
        seen.push(
          Array.from(document.querySelectorAll(".swap2"))
            .map((e) => e.textContent)
            .join("|"),
        );
      }
    }

    class Panel extends Component<{ n: number }> {
      reporter = this.use(Reporter);
      render() {
        return (
          <div className="swap2">
            <span>{String(this.props.n)}</span>
          </div>
        );
      }
    }

    class App extends Component {
      @state n = 1;
      render() {
        return (
          <div>
            <Panel key={String(this.n)} n={this.n} />
          </div>
        );
      }
    }

    const app = await getDOM<App>(<App />);
    app.instance.n = 2;
    await app.settle();

    // Before the insert-after-unmount fix this read "1|2".
    expect(seen).toEqual(["1"]);
  });

  test("a hook's @mounted is skipped when its owner is destroyed first", async () => {
    const ran: string[] = [];

    class Late extends Hook {
      @mounted ready() {
        ran.push("hook:mount");
      }
      @destroyed gone() {
        ran.push("hook:destroy");
      }
    }

    class Holder extends Component {
      late = this.use(Late);
      render() {
        return <span>h</span>;
      }
    }

    class Early extends Component<{ container?: HTMLElement }> {
      @mounted ready() {
        ran.push("early:mount");
        if (this.props.container) unmount(this.props.container);
      }
      render() {
        return <span>e</span>;
      }
    }

    const container = document.createElement("div");
    container.id = "app-hook-teardown";
    document.body.appendChild(container);

    class App extends Component<{ container: HTMLElement }> {
      render() {
        return (
          <div>
            <Early container={this.props.container} />
            <Holder />
          </div>
        );
      }
    }

    const { bootstrap } = await import("../../index");
    bootstrap(<App container={container} />, container);

    expect(ran).toContain("early:mount");
    // The guard keys on the owner component, and the hook rides along with it.
    expect(ran).not.toContain("hook:mount");
    container.remove();
  });
});
