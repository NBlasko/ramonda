import { describe, test, expect } from "vitest";
import { Component, Hook, state, bootstrap, unmount } from "../../index";
import { flushSync, getComponentInstance } from "../../testing";
import { INTERNAL_HOOKS } from "../../core/runtime";

/**
 * A hook whose props can never move, with no hook of its own, is left off its owner's walk.
 *
 * Production only — a development build walks every hook, because RMD027 is asked on the walk (see
 * `register` in `helpers/common.ts`). So this runs with `__DEV__` false, in its own process; see
 * `vitest.prod.config.ts`.
 *
 * What the walk holds is internal, and it is read here on purpose: the change is that an update is
 * NOT called, and a call that does nothing cannot be seen from outside. The second half is what can
 * be seen — the hooks that stay on it still get their props.
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

/** Takes nothing, and grows a hook of its own when asked — after construction. */
class Grows extends Hook {
  @state n = 1;
  late: Takes | undefined;

  grow(): void {
    this.late = this.use(Takes, (self: Grows) => ({ value: self.n }));
  }
}

/** Takes a number, and says it. */
class Says extends Hook<{ x: number }> {
  get value(): number {
    return this.props.x;
  }
}

/** Takes nothing, and grows a hook that reads its own state, when asked. */
class GrowsReading extends Hook {
  @state n = 1;
  child: Says | undefined;

  grow(): void {
    this.child = this.use(Says, (self: GrowsReading) => ({ x: self.n }));
  }
}

/** Reads what it is handed. */
class Reads extends Hook<{ v: number | undefined; tick: number }> {
  get v(): number | undefined {
    return this.props.v;
  }
}

/** Takes nothing, and grows a hook reading its own state the first time it is asked to. */
class GrowsOnce extends Hook {
  @state n = 1;
  child: Says | undefined;

  ensure(): void {
    this.child ??= this.use(Says, (self: GrowsOnce) => ({ x: self.n }));
  }
}

/** Takes a tick, and nothing else. */
class Ticks extends Hook<{ t: number }> {}

/** Takes a number, and says it. */
class Shows extends Hook<{ v: number }> {
  get v(): number {
    return this.props.v;
  }
}

/**
 * A hook owning three: the first asleep, the second waking it from its props callback — during the walk
 * — and the third after both.
 */
class WakesMidWalk extends Hook {
  @state tick = 0;
  sleeper = this.use(GrowsOnce);
  waker = this.use(Ticks, (self: WakesMidWalk) => {
    if (self.tick > 0) self.sleeper.ensure();
    return { t: self.tick };
  });
  last = this.use(Shows, (self: WakesMidWalk) => ({ v: self.tick }));
}

/** Freezes itself in its constructor, holding a hook that sleeps until it grows one of its own. */
class FrozenOwner extends Hook {
  sleeper = this.use(Grows);
  constructor(...args: ConstructorParameters<typeof Hook<undefined>>) {
    super(...args);
    Object.freeze(this);
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

const walked = (owner: object): number =>
  (owner as { [INTERNAL_HOOKS]?: { list: unknown[] } })[INTERNAL_HOOKS]?.list.length ?? 0;

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

  test("a hook left off goes back on when it grows a hook that can move", () => {
    class Page extends Component {
      @state tick = 0;
      grows = this.use(Grows);
      render() {
        return (
          <p>
            {String(this.grows.late?.value)}:{this.tick}
          </p>
        );
      }
    }
    const { instance, container, done } = mount<Page>(<Page />);
    expect(walked(instance)).toBe(0);

    instance.grows.grow();
    instance.tick++;
    flushSync();
    expect(walked(instance)).toBe(1);
    expect(container.textContent).toBe("1:1");

    // The late hook's input moves, and the owner's next render carries it there.
    instance.grows.n = 7;
    instance.tick++;
    flushSync();
    expect(container.textContent).toBe("7:2");
    done();
  });

  /**
   * Back in its `use()` place, not at the end: `reads` is used after `grows` and reads what `grows`'s
   * child says, so `grows` has to be updated first. Woken at the end of the walk, `reads` was updated
   * before the child heard its new input and showed the old value — in production only, since in
   * development nothing sleeps.
   */
  test("a hook that goes back on is walked where it was used, before the hooks used after it", () => {
    class Page extends Component {
      @state tick = 0;
      // Asleep, and used before `grows`: not on the walk, so not counted when `grows` is put back.
      asleep = this.use(Bare);
      grows = this.use(GrowsReading);
      reads = this.use(Reads, (self: Page) => ({ v: self.grows.child?.value, tick: self.tick }));
      render() {
        return <p>{String(this.reads.v)}</p>;
      }
    }
    const { instance, container, done } = mount<Page>(<Page />);
    instance.grows.grow();
    instance.tick++;
    flushSync();
    expect(container.textContent).toBe("1");

    instance.grows.n = 5;
    instance.tick++;
    flushSync();
    expect(container.textContent).toBe("5");
    done();
  });

  /**
   * Woken DURING a walk, a hook goes into a copy of the list: the walk in progress finishes over the
   * list it began with. Spliced into that list instead, every hook after it shifted along by one and
   * the walk ended a hook early — `last` kept its old props and the page showed 0.
   */
  test("a hook woken during its owner's walk does not push another off that walk", () => {
    class Page extends Component {
      @state n = 0;
      owner = this.use(WakesMidWalk);
      render() {
        return (
          <p>
            {this.owner.last.v}:{this.n}
          </p>
        );
      }
    }
    const { instance, container, done } = mount<Page>(<Page />);
    instance.owner.tick = 1;
    instance.n++;
    flushSync();
    expect(container.textContent).toBe("1:1");
    done();
  });

  /**
   * A hook that froze itself can still have a hook of its own woken: the walk is a box written onto it
   * once, and a registration replaces the list INSIDE the box. Replacing the list on the owner itself
   * threw — `Cannot assign to read only property` — the moment the hook it held woke.
   */
  test("a hook woken under an owner that froze itself goes back on", () => {
    class Page extends Component {
      @state tick = 0;
      owner = this.use(FrozenOwner);
      render() {
        return (
          <p>
            {String(this.owner.sleeper.late?.value)}:{this.tick}
          </p>
        );
      }
    }
    const { instance, container, done } = mount<Page>(<Page />);
    instance.owner.sleeper.grow();
    instance.owner.sleeper.n = 4;
    instance.tick++;
    flushSync();
    expect(container.textContent).toBe("4:1");
    done();
  });
});
