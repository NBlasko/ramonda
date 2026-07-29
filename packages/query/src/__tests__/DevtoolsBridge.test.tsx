import { Component, state } from "@ramonda/core";
import { act, render } from "@ramonda/testing-library";
import { afterEach, describe, expect, test } from "vitest";
import { QueryClientProvider } from "../context";
import { Query } from "../Query";
import type { QueryBridge } from "../devtoolsBridge";

/**
 * What `@ramonda/devtools`' Query tab reads.
 *
 * The panel is a custom element outside the tree, so it cannot see a provider — it calls a
 * global the same way it calls core's `__RAMONDA_INSPECT__`. These tests hold that contract
 * still: a live cache is listed, a torn-down one is not, and the two actions do what their
 * labels say.
 */

const settle = () => act(async () => {});

function bridge(): QueryBridge {
  const found = (globalThis as { __RAMONDA_QUERY__?: QueryBridge }).__RAMONDA_QUERY__;
  if (!found) throw new Error("the bridge was not installed");
  return found;
}

afterEach(() => {
  // The registry is module state; a leaked client would show up in the next test's snapshot.
  const rows = bridge().snapshot();
  expect(rows.clients.length).toBe(0);
});

function mount(load: () => Promise<{ name: string }>) {
  class Card extends Component {
    private provider = this.use(QueryClientProvider);
    @state id = "ada";

    user = this.use(Query, (self: Card) => ({
      key: ["user", self.id],
      fetch: load,
    }));

    render() {
      void this.provider;
      return <span id="out">{this.user.data?.name ?? this.user.status}</span>;
    }
  }

  return render(<Card />);
}

describe("the devtools bridge", () => {
  test("lists a live cache, with the key, the status and the observer count", async () => {
    const { container, unmount } = mount(async () => ({ name: "Ada" }));

    try {
      await settle();
      expect(container.querySelector("#out")!.textContent).toBe("Ada");

      const { clients } = bridge().snapshot();
      expect(clients.length).toBe(1);
      expect(clients[0]!.queries.length).toBe(1);

      const row = clients[0]!.queries[0]!;
      expect(row.key).toEqual(["user", "ada"]);
      expect(row.status).toBe("success");
      expect(row.fetchStatus).toBe("idle");
      expect(row.observers).toBe(1);
      expect(row.dataPreview).toBe('{"name":"Ada"}');
      expect(row.error).toBeUndefined();
      expect(row.updatedAt).toBeGreaterThan(0);
    } finally {
      unmount();
    }
  });

  test("invalidate from the panel refreshes whoever is watching", async () => {
    let calls = 0;
    const { container, unmount } = mount(async () => ({ name: `Ada ${++calls}` }));

    try {
      await settle();
      expect(container.querySelector("#out")!.textContent).toBe("Ada 1");

      const row = bridge().snapshot().clients[0]!.queries[0]!;
      await act(async () => {
        bridge().invalidate(0, row.hash);
      });
      await settle();

      // Not just marked stale: the observer is asked to refresh, which is the whole point
      // of the button. There is no refetch button because the fetcher lives with the
      // observer, not with the cache.
      expect(container.querySelector("#out")!.textContent).toBe("Ada 2");
      expect(calls).toBe(2);
    } finally {
      unmount();
    }
  });

  test("remove throws the data away, and a watching query starts over", async () => {
    let calls = 0;
    const { container, unmount } = mount(async () => ({ name: `Ada ${++calls}` }));

    try {
      await settle();
      const row = bridge().snapshot().clients[0]!.queries[0]!;
      expect(row.status).toBe("success");

      await act(async () => {
        bridge().remove(0, row.hash);
      });
      await settle();

      /**
       * The ROW does not vanish, and that is right rather than surprising: an observer is
       * still watching this key, so it re-subscribes onto a fresh entry and fetches again
       * (`remove` notifies observers with `"removed"` precisely so they do not go on
       * rendering something deleted). What is gone is the data — the second call proves the
       * cache had nothing left to answer with.
       */
      expect(calls).toBe(2);
      expect(container.querySelector("#out")!.textContent).toBe("Ada 2");

      const after = bridge().snapshot().clients[0]!.queries[0]!;
      expect(after.hash).toBe(row.hash);
      expect(after.updatedAt).toBeGreaterThan(0);
    } finally {
      unmount();
    }
  });

  test("remove clears an entry nobody is watching", async () => {
    class Holder extends Component {
      provider = this.use(QueryClientProvider);
      @state show = true;
      render() {
        return <div>{this.show ? <Leaf /> : null}</div>;
      }
    }

    class Leaf extends Component {
      user = this.use(Query, () => ({ key: ["parked"], fetch: async () => ({ name: "Ada" }) }));
      render() {
        return <span>{this.user.status}</span>;
      }
    }

    const { instance, unmount } = render(<Holder />);

    try {
      await settle();
      await act(async () => {
        (instance as { show: boolean }).show = false;
      });

      const row = bridge().snapshot().clients[0]!.queries[0]!;
      expect(row.observers).toBe(0);

      await act(async () => {
        bridge().remove(0, row.hash);
      });

      // Nobody left to re-subscribe, so the row is gone for good — which is what the button
      // is for: dropping what is sitting out its gcTime.
      expect(bridge().snapshot().clients[0]!.queries.length).toBe(0);
    } finally {
      unmount();
    }
  });

  test("an action on a row that is already gone does nothing", async () => {
    const { unmount } = mount(async () => ({ name: "Ada" }));

    try {
      await settle();
      const row = bridge().snapshot().clients[0]!.queries[0]!;
      await act(async () => {
        bridge().remove(0, row.hash);
      });

      // The panel draws a snapshot; by the time a button is clicked the entry may have been
      // collected. Looking it up fresh is what keeps this from throwing.
      expect(() => bridge().invalidate(0, row.hash)).not.toThrow();
      expect(() => bridge().remove(0, row.hash)).not.toThrow();
      expect(() => bridge().invalidate(99, "nope")).not.toThrow();
    } finally {
      unmount();
    }
  });

  test("a provider that unmounts takes its cache out of the list", async () => {
    const { unmount } = mount(async () => ({ name: "Ada" }));
    await settle();
    expect(bridge().snapshot().clients.length).toBe(1);

    unmount();

    // Otherwise the panel would hold every cache the session ever built alive, and would
    // list ones belonging to a torn-down tree.
    expect(bridge().snapshot().clients.length).toBe(0);
  });

  test("two providers are listed separately", async () => {
    const first = mount(async () => ({ name: "Ada" }));
    const second = mount(async () => ({ name: "Grace" }));

    try {
      await settle();
      const { clients } = bridge().snapshot();
      expect(clients.length).toBe(2);
      expect(clients.map((c) => c.index)).toEqual([0, 1]);
      expect(clients[0]!.queries[0]!.dataPreview).toBe('{"name":"Ada"}');
      expect(clients[1]!.queries[0]!.dataPreview).toBe('{"name":"Grace"}');
    } finally {
      first.unmount();
      second.unmount();
    }
  });

  test("an entry with no observers is reported as such, and an error is described", async () => {
    class Holder extends Component {
      provider = this.use(QueryClientProvider);
      @state show = true;

      render() {
        return <div>{this.show ? <Child /> : null}</div>;
      }
    }

    class Child extends Component {
      user = this.use(Query, () => ({
        key: ["broken"],
        retry: 0,
        fetch: async () => {
          throw new Error("nope");
        },
      }));

      render() {
        return <span>{this.user.status}</span>;
      }
    }

    const { instance, unmount } = render(<Holder />);

    try {
      await settle();
      let row = bridge().snapshot().clients[0]!.queries[0]!;
      expect(row.status).toBe("error");
      expect(row.error).toBe("nope");
      expect(row.observers).toBe(1);

      await act(async () => {
        (instance as { show: boolean }).show = false;
      });

      // Still cached, nobody watching — the state people ask the panel about.
      row = bridge().snapshot().clients[0]!.queries[0]!;
      expect(row.observers).toBe(0);
    } finally {
      unmount();
    }
  });

  test("unserializable data is described rather than thrown over", async () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    class Card extends Component {
      private provider = this.use(QueryClientProvider);
      user = this.use(Query, () => ({ key: ["cyclic"], fetch: async () => cyclic }));
      render() {
        void this.provider;
        return <span>{this.user.status}</span>;
      }
    }

    const { unmount } = render(<Card />);

    try {
      await settle();
      expect(bridge().snapshot().clients[0]!.queries[0]!.dataPreview).toBe("[unserializable]");
    } finally {
      unmount();
    }
  });

  /**
   * The cap was 120, and 120 showed the shape of the answer and nothing in it — the panel
   * displayed `{"products":[{"id":1,"title":"Essence Masc…`, which is the key read back to you.
   * A preview scrolls in its own box now, so the cap is only here to keep a megabyte of cached
   * data off the wire on every poll. Both ends are worth holding: an ordinary payload arrives
   * whole, a pathological one is still bounded.
   */
  test("an ordinary payload arrives whole", async () => {
    class Card extends Component {
      private provider = this.use(QueryClientProvider);
      user = this.use(Query, () => ({
        key: ["ordinary"],
        fetch: async () => ({ text: "x".repeat(500) }),
      }));
      render() {
        void this.provider;
        return <span>{this.user.status}</span>;
      }
    }

    const { unmount } = render(<Card />);

    try {
      await settle();
      const preview = bridge().snapshot().clients[0]!.queries[0]!.dataPreview;
      expect(preview.endsWith("…")).toBe(false);
      expect(preview).toBe(JSON.stringify({ text: "x".repeat(500) }));
    } finally {
      unmount();
    }
  });

  test("a pathological one is still cut, so one row cannot fill the panel", async () => {
    class Card extends Component {
      private provider = this.use(QueryClientProvider);
      user = this.use(Query, () => ({
        key: ["long"],
        fetch: async () => ({ text: "x".repeat(50_000) }),
      }));
      render() {
        void this.provider;
        return <span>{this.user.status}</span>;
      }
    }

    const { unmount } = render(<Card />);

    try {
      await settle();
      const preview = bridge().snapshot().clients[0]!.queries[0]!.dataPreview;
      expect(preview.length).toBeLessThan(2100);
      expect(preview.endsWith("…")).toBe(true);
    } finally {
      unmount();
    }
  });

  /**
   * The panel renders a tree, so it needs the structure and not a line of it. What crosses the
   * bridge is a bounded COPY: the panel must not be able to hold the app's objects, a cache can
   * hold anything a fetcher returned, and both bounds are load-bearing — the depth cap is what
   * makes a cycle safe, the budget is what makes a huge answer safe.
   */
  test("sends the value as a bounded copy, not a reference", async () => {
    const payload = { products: [{ id: 1, title: "Mascara" }] };

    class Card extends Component {
      private provider = this.use(QueryClientProvider);
      user = this.use(Query, () => ({ key: ["structured"], fetch: async () => payload }));
      render() {
        void this.provider;
        return <span>{this.user.status}</span>;
      }
    }

    const { unmount } = render(<Card />);

    try {
      await settle();
      const sent = bridge().snapshot().clients[0]!.queries[0]!.data as typeof payload;
      expect(sent).toEqual(payload);
      // A copy: the panel holding it cannot keep the cached object alive, and cannot mutate it.
      expect(sent).not.toBe(payload);
      expect(sent.products).not.toBe(payload.products);
    } finally {
      unmount();
    }
  });

  test("names a cycle instead of hanging on it", async () => {
    const loop: Record<string, unknown> = { name: "a" };
    loop.self = loop;

    class Card extends Component {
      private provider = this.use(QueryClientProvider);
      user = this.use(Query, () => ({ key: ["cyclic-structured"], fetch: async () => loop }));
      render() {
        void this.provider;
        return <span>{this.user.status}</span>;
      }
    }

    const { unmount } = render(<Card />);

    try {
      await settle();
      const sent = bridge().snapshot().clients[0]!.queries[0]!.data as Record<string, unknown>;
      expect(sent.name).toBe("a");
      expect(sent.self).toBe("[circular]");
    } finally {
      unmount();
    }
  });

  test("bounds a value too large to copy, and says so", async () => {
    const huge = { rows: Array.from({ length: 30_000 }, (_, i) => ({ i })) };

    class Card extends Component {
      private provider = this.use(QueryClientProvider);
      user = this.use(Query, () => ({ key: ["huge"], fetch: async () => huge }));
      render() {
        void this.provider;
        return <span>{this.user.status}</span>;
      }
    }

    const { unmount } = render(<Card />);

    try {
      await settle();
      const sent = bridge().snapshot().clients[0]!.queries[0]!.data as { rows: unknown[] };
      expect(sent.rows).toHaveLength(30_000);
      // Past the budget the copy stops carrying values and starts saying that it stopped.
      expect(sent.rows.at(-1)).toBe("[… budget]");
    } finally {
      unmount();
    }
  });
});
