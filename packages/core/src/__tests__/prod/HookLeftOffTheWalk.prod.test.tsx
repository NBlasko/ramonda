import { describe, test, expect } from "vitest";
import { Component, Hook, state, bootstrap, unmount } from "../../index";
import { flushSync, getComponentInstance } from "../../testing";
import { INTERNAL_HOOKS } from "../../core/runtime";

/**
 * A hook whose props can never move, with no hook of its own, is left off its owner's walk.
 *
 * Production only — a development build walks every hook, because RMD027 is asked on the walk (see
 * `useCommon` in `helpers/common.ts`). So this runs with `__DEV__` false, in its own process; see
 * `vitest.prod.config.ts`.
 *
 * What the walk holds is internal, and it is read here on purpose: the change is that an update is
 * NOT called, and a call that does nothing cannot be seen from outside. The second half is what can
 * be seen — the hooks that stay on it still get their props.
 *
 * Leaving a hook off is final, because a hook gains no hook after its construction: `use()` on a
 * constructed owner throws in every build (RMD063), which the last test pins in this one.
 */

const SCHEMA = { kind: "schema" };

/** Takes nothing, like `Navigator` or a context consumer. */
class Bare extends Hook {}

/** Takes props a callback builds. */
class Takes extends Hook<{ value: unknown }> {
  get value(): unknown {
    return this.props.value;
  }
}

function mount<T>(node: unknown): { instance: T; container: HTMLElement; done: () => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  bootstrap(node as never, container);
  flushSync();
  const instance = getComponentInstance(container.firstElementChild) as unknown as T;
  return {
    instance,
    container,
    done: () => {
      unmount(container);
      container.remove();
    },
  };
}

const walked = (owner: object): number => (owner as { [INTERNAL_HOOKS]?: unknown[] })[INTERNAL_HOOKS]?.length ?? 0;

describe("a hook left off its owner's walk", () => {
  test("__DEV__ is false in this run", () => {
    expect(__DEV__).toBe(false);
  });

  test("only the hook whose props can move is walked", () => {
    class Page extends Component {
      @state n = 0;
      bare = this.use(Bare);
      constant = this.use(Takes, (self: Page) => ({ value: { schema: SCHEMA, onSubmit: self.submit } }));
      moving = this.use(Takes, (self: Page) => ({ value: self.n }));
      submit(): void {}
      render() {
        return <p>{String(this.moving.value)}</p>;
      }
    }
    const { instance, container, done } = mount<Page>(<Page />);

    expect(walked(instance)).toBe(1);

    // And the one that is walked still gets its props.
    instance.n = 5;
    flushSync();
    expect(container.textContent).toBe("5");
    done();
  });

  test("a hook whose own hook can move is walked, to reach it", () => {
    class Parent extends Hook {
      @state n = 1;
      child = this.use(Takes, (self: Parent) => ({ value: self.n }));
    }
    class Page extends Component {
      @state tick = 0;
      parent = this.use(Parent);
      render() {
        return (
          <p>
            {String(this.parent.child.value)}:{this.tick}
          </p>
        );
      }
    }
    const { instance, container, done } = mount<Page>(<Page />);

    expect(walked(instance)).toBe(1);

    instance.parent.n = 2;
    instance.tick++;
    flushSync();
    expect(container.textContent).toBe("2:1");
    done();
  });

  test("a hook that tries to gain a hook after its construction is refused, in production too", () => {
    class Grows extends Hook {
      grow(): void {
        this.use(Takes, () => ({ value: 1 }));
      }
    }
    class Page extends Component {
      grows = this.use(Grows);
      render() {
        return <p />;
      }
    }
    const { instance, done } = mount<Page>(<Page />);

    expect(() => instance.grows.grow()).toThrow(/RMD063/);
    expect(walked(instance)).toBe(0);
    done();
  });
});
