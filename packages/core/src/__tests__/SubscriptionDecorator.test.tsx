import { describe, test, expect, beforeEach } from "vitest";
import { createSubscriptionDecorator, state } from "../base/decorators";
import { Component } from "../base/Component";
import { Hook } from "../base/Hook";
import { getDOM } from "../test/setup";

/**
 * `createSubscriptionDecorator` is the public door onto the effect primitive:
 * subscribe, return the unsubscribe, and the framework owns the teardown.
 *
 * The thing under test is the CLEANUP, because that is the part an app gets
 * wrong. A store subscription that outlives its component is not a visible bug —
 * the page still works, the handler just keeps firing into a dead instance for
 * as long as the tab is open.
 */

/** A minimal external store: read a value, subscribe, and get an unsubscribe function back. */
function createStore<T>(initial: T) {
  let value = initial;
  const listeners = new Set<(value: T) => void>();
  return {
    getState: () => value,
    setState(next: T) {
      value = next;
      for (const listener of [...listeners]) listener(next);
    },
    subscribe(listener: (value: T) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get listenerCount() {
      return listeners.size;
    },
  };
}

type Store<T> = ReturnType<typeof createStore<T>>;

const onStore = createSubscriptionDecorator(
  "onStore",
  (_owner, handler: (value: string) => void, store: Store<string>) => store.subscribe(handler),
);

let store: Store<string>;
beforeEach(() => {
  store = createStore("initial");
});

describe("createSubscriptionDecorator", () => {
  test("subscribes on mount and pushes store changes into the component", async () => {
    class Panel extends Component {
      @state label = "";

      @onStore(store)
      storeChanged(value: string) {
        this.label = value;
      }

      render() {
        return <p>{this.label}</p>;
      }
    }

    const { container, settle } = await getDOM(<Panel />);
    expect(store.listenerCount).toBe(1);

    store.setState("from the store");
    await settle();

    expect(container.textContent).toContain("from the store");
  });

  test("unsubscribes when the component is destroyed", async () => {
    class Panel extends Component {
      @onStore(store)
      storeChanged(_value: string) {}
      render() {
        return <p />;
      }
    }

    const { unmount } = await getDOM(<Panel />);
    expect(store.listenerCount).toBe(1);

    unmount();

    // The whole point: nothing in Panel had to remember this.
    expect(store.listenerCount).toBe(0);
  });

  test("a re-render caused by other state does not re-subscribe", async () => {
    class Panel extends Component {
      @state unrelated = 0;

      @onStore(store)
      storeChanged(_value: string) {}

      render() {
        return <p>{this.unrelated}</p>;
      }
    }

    const { instance, settle } = await getDOM<Panel>(<Panel />);
    expect(store.listenerCount).toBe(1);

    instance.unrelated = 1;
    await settle();

    // A subscription that piled up per render would show 2 here.
    expect(store.listenerCount).toBe(1);
  });

  test("a connect that READS a signal follows it, disconnecting the old one", async () => {
    const stores = { a: createStore("a"), b: createStore("b") };

    const onNamedStore = createSubscriptionDecorator("onNamedStore", (owner: Panel, handler: (value: string) => void) =>
      stores[owner.which].subscribe(handler),
    );

    class Panel extends Component {
      @state which: "a" | "b" = "a";
      @state seen = "";

      @onNamedStore()
      changed(value: string) {
        this.seen = value;
      }

      render() {
        return <p>{this.seen}</p>;
      }
    }

    const { instance, settle } = await getDOM<Panel>(<Panel />);
    expect([stores.a.listenerCount, stores.b.listenerCount]).toEqual([1, 0]);

    instance.which = "b";
    await settle();

    // Moved, not added: the old subscription is gone.
    expect([stores.a.listenerCount, stores.b.listenerCount]).toEqual([0, 1]);
  });

  test("works on a Hook, which has a runtime but no element", async () => {
    class StoreHook extends Hook {
      @state value = "";

      @onStore(store)
      changed(next: string) {
        this.value = next;
      }
    }

    class Panel extends Component {
      private store = this.use(StoreHook);
      render() {
        return <p>{this.store.value}</p>;
      }
    }

    const { container, settle, unmount } = await getDOM(<Panel />);
    expect(store.listenerCount).toBe(1);

    store.setState("through the hook");
    await settle();
    expect(container.textContent).toContain("through the hook");

    // A hook shares its owner's runtime, so the owner's teardown covers it.
    unmount();
    expect(store.listenerCount).toBe(0);
  });

  test("validateArgs runs at class-definition time, not on the first commit", () => {
    const guarded = createSubscriptionDecorator(
      "guarded",
      (_owner, _handler: () => void, _channel: string) => () => {},
      (channel) => {
        if (channel.length === 0) throw new Error("[@guarded] empty channel");
      },
    );

    // Nothing is mounted here — defining the class is enough.
    expect(() => {
      class Bad extends Component {
        @guarded("")
        onMessage() {}
        render() {
          return <p />;
        }
      }
      return Bad;
    }).toThrow(/\[@guarded\] empty channel/);
  });

  test("rejects a decorator put on something that is not a method", () => {
    const anything = createSubscriptionDecorator("anything", (_owner, _handler: () => void) => () => {});

    expect(() => {
      class Bad extends Component {
        // @ts-expect-error — runtime guard is the point.
        @anything() value = 1;
        render() {
          return <p />;
        }
      }
      return Bad;
    }).toThrow(/\[@anything\].*Can only decorate a method/s);
  });

  test("DEV rejects a connect that returns a subscription OBJECT", async () => {
    // The leak this check exists for: `{ unsubscribe }` is a common return
    // shape, it is not a function, so the effect would drop it and the
    // subscription would outlive the component with nothing to say so.
    const objectStore = createSubscriptionDecorator("objectStore", (_owner, handler: (value: string) => void) => {
      const off = store.subscribe(handler);
      return { unsubscribe: off } as unknown as () => void;
    });

    class Panel extends Component {
      @objectStore()
      changed(_value: string) {}
      render() {
        return <p />;
      }
    }

    await expect(getDOM(<Panel />)).rejects.toThrow(
      /\[@objectStore\].*an object with keys: unsubscribe.*must return a cleanup FUNCTION.*sub\.unsubscribe/s,
    );
  });

  test("a connect may return nothing when there is nothing to undo", async () => {
    const calls: string[] = [];
    const fireAndForget = createSubscriptionDecorator("fireAndForget", (_owner, handler: () => void) => {
      handler();
    });

    class Panel extends Component {
      @fireAndForget()
      ping() {
        calls.push("ping");
      }
      render() {
        return <p />;
      }
    }

    const { unmount } = await getDOM(<Panel />);
    expect(calls).toEqual(["ping"]);
    expect(() => unmount()).not.toThrow();
  });
});

/**
 * A one-off subscription, without declaring a reusable decorator.
 *
 * The factory is the answer for a subscription however many times it is used — declared beside
 * the component when that is once, which is what this pins. One way to say it, and the cleanup
 * is what the body returns rather than something a caller may forget.
 *
 * The reactive half is the part worth keeping: `connect` READS `owner.channel`, so switching
 * channels tears the old subscription down before making the new one.
 */
describe("a locally declared subscription decorator", () => {
  test("the returned function is the cleanup, on re-run and on destroy", async () => {
    const log: string[] = [];

    interface ChannelOwner extends Component {
      channel: string;
    }

    const onChannel = createSubscriptionDecorator(
      "onChannel",
      (owner: ChannelOwner, handler: (line: string) => void) => {
        const channel = owner.channel;
        handler(`subscribe:${channel}`);
        return () => handler(`unsubscribe:${channel}`);
      },
    );

    class Panel extends Component {
      @state channel = "a";

      @onChannel()
      onLine(line: string) {
        log.push(line);
      }

      render() {
        return <p>{this.channel}</p>;
      }
    }

    const { instance, settle, unmount } = await getDOM<Panel>(<Panel />);
    expect(log).toEqual(["subscribe:a"]);

    instance.channel = "b";
    await settle();
    expect(log).toEqual(["subscribe:a", "unsubscribe:a", "subscribe:b"]);

    unmount();
    expect(log).toEqual(["subscribe:a", "unsubscribe:a", "subscribe:b", "unsubscribe:b"]);
  });
});
