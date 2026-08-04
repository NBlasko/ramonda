import { Component, state } from "@ramonda/core";
import { act, render } from "@ramonda/testing-library";
import { afterEach, describe, expect, test } from "vitest";
import { QueryClientProvider } from "../context";
import { Query } from "../Query";
// Importing the entry is what registers the tab — the same line an app writes.
import "../devtools";
import { panelRegistry } from "../devtoolsPanel";
import type { PanelPlugin, PanelRow } from "../devtoolsPanel";

/**
 * What `@ramonda/devtools` renders for the Query tab.
 *
 * The panel is a custom element outside the tree, so it cannot see a provider. This package
 * describes its cache as rows and registers that description; the panel draws it without knowing
 * anything about queries. These tests hold that description still: a live cache is listed, a
 * torn-down one is not, and the two actions do what their labels say.
 */

const settle = () => act(async () => {});

function panel(): PanelPlugin {
  const found = panelRegistry()
    .list()
    .find((plugin) => plugin.id === "query");
  if (!found) throw new Error("the Query panel was not registered");
  return found;
}

/** The observer count a row reports, back out of the line it renders as. */
function observersOf(row: PanelRow): number {
  const found = /(\d+) observers?/.exec(text(row));
  return found ? Number(found[1]) : 0;
}

/** A row's metadata as one string, which is where status, age and observers now live. */
function text(row: PanelRow): string {
  return (row.fields ?? []).map((field) => ("text" in field ? field.text : "")).join(" · ");
}

/** Every row across every live client, which is what most of these assert about. */
function rows(): PanelRow[] {
  return panel()
    .snapshot()
    .groups.flatMap((group) => group.rows);
}

afterEach(() => {
  // The client list is module state; a leaked one would show up in the next test's snapshot.
  expect(rows()).toEqual([]);
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

      const groups = panel().snapshot().groups;
      expect(groups.length).toBe(1);
      expect(groups[0]!.rows.length).toBe(1);

      const row = groups[0]!.rows[0]!;
      // The key is the row's TITLE now — a panel shows it, it does not parse it.
      expect(row.title).toBe('["user","ada"]');
      expect(row.status).toBe("ok");
      expect(text(row)).toContain("success");
      expect(text(row)).toContain("1 observer");
      expect(row.value!.preview).toBe('{"name":"Ada"}');
      expect(row.error).toBeUndefined();
      expect(row.value!.revision).toBeGreaterThan(0);
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

      const row = rows()[0]!;
      await act(async () => {
        panel().run!(row.id, "invalidate");
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
      const row = rows()[0]!;
      expect(row.status).toBe("ok");

      await act(async () => {
        panel().run!(row.id, "remove");
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

      const after = rows()[0]!;
      expect(after.id).toBe(row.id);
      expect(Number(after.value!.revision)).toBeGreaterThan(0);
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

      const row = rows()[0]!;
      expect(text(row)).toContain("0 observers · waiting for gc");

      await act(async () => {
        panel().run!(row.id, "remove");
      });

      // Nobody left to re-subscribe, so the row is gone for good — which is what the button
      // is for: dropping what is sitting out its gcTime.
      expect(rows().length).toBe(0);
    } finally {
      unmount();
    }
  });

  test("an action on a row that is already gone does nothing", async () => {
    const { unmount } = mount(async () => ({ name: "Ada" }));

    try {
      await settle();
      const row = rows()[0]!;
      await act(async () => {
        panel().run!(row.id, "remove");
      });

      // The panel draws a snapshot; by the time a button is clicked the entry may have been
      // collected. Looking it up fresh is what keeps this from throwing.
      expect(() => panel().run!(row.id, "invalidate")).not.toThrow();
      expect(() => panel().run!(row.id, "remove")).not.toThrow();
      expect(() => panel().run!("99::nope", "invalidate")).not.toThrow();
    } finally {
      unmount();
    }
  });

  test("a provider that unmounts takes its cache out of the list", async () => {
    const { unmount } = mount(async () => ({ name: "Ada" }));
    await settle();
    expect(panel().snapshot().groups.length).toBe(1);

    unmount();

    // Otherwise the panel would hold every cache the session ever built alive, and would
    // list ones belonging to a torn-down tree.
    expect(panel().snapshot().groups.length).toBe(0);
  });

  test("two providers are listed separately", async () => {
    const first = mount(async () => ({ name: "Ada" }));
    const second = mount(async () => ({ name: "Grace" }));

    try {
      await settle();
      const groups = panel().snapshot().groups;
      expect(groups.length).toBe(2);
      // Labelled only when there is more than one, which is exactly this case.
      expect(groups.map((group) => group.label)).toEqual(["client 1 · 1 query", "client 2 · 1 query"]);
      expect(groups[0]!.rows[0]!.value!.preview).toBe('{"name":"Ada"}');
      expect(groups[1]!.rows[0]!.value!.preview).toBe('{"name":"Grace"}');
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
      let row = rows()[0]!;
      expect(row.status).toBe("error");
      expect(row.error).toBe("nope");
      expect(observersOf(row)).toBe(1);

      await act(async () => {
        (instance as { show: boolean }).show = false;
      });

      // Still cached, nobody watching — the state people ask the panel about.
      row = rows()[0]!;
      expect(observersOf(row)).toBe(0);
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
      expect(rows()[0]!.value!.preview).toBe("[unserializable]");
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
      const preview = rows()[0]!.value!.preview!;
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
      const preview = rows()[0]!.value!.preview!;
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
      const sent = rows()[0]!.value!.data as typeof payload;
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
      const sent = rows()[0]!.value!.data as Record<string, unknown>;
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
      const sent = rows()[0]!.value!.data as { rows: unknown[] };
      expect(sent.rows).toHaveLength(30_000);
      // Past the budget the copy stops carrying values and starts saying that it stopped.
      expect(sent.rows.at(-1)).toBe("[… budget]");
    } finally {
      unmount();
    }
  });

  /**
   * The panel's write side, and the one place where editing a value in devtools shows up on the page:
   * the cache IS what a query renders from.
   */
  test("setData from the panel reaches whoever is watching", async () => {
    const { container, unmount } = mount(async () => ({ name: "Ada" }));

    try {
      await settle();
      expect(container.querySelector("#out")!.textContent).toBe("Ada");

      const row = rows()[0]!;
      await act(async () => {
        // `undefined` means the write was taken; a string would be the reason it was not.
        expect(row.value!.write!({ name: "Grace" })).toBeUndefined();
      });

      expect(container.querySelector("#out")!.textContent).toBe("Grace");
      // Through `setData`, so the entry is a normal successful entry afterwards.
      const after = rows()[0]!;
      expect(after.status).toBe("ok");
      expect(Number(after.value!.revision)).toBeGreaterThanOrEqual(Number(row.value!.revision));
    } finally {
      unmount();
    }
  });

  test("a write refuses when the entry it was built for has gone", async () => {
    const { unmount } = mount(async () => ({ name: "Ada" }));
    await settle();

    /**
     * A row is a SNAPSHOT, so the panel can always be holding one whose entry has since gone —
     * here because the provider unmounted, which takes the whole cache with it.
     *
     * Removing the entry would not do: a query that is still watching refetches immediately, so
     * an entry with the same key is back before the write lands. That is the cache working, and
     * it is why this reaches for the case where there is nothing left at all.
     */
    const stale = rows()[0]!;
    unmount();

    expect(stale.value!.write!({ name: "x" })).toBe("that entry is no longer in the cache");
  });

  /**
   * The flag the panel uses to decide whether the data may be edited at all. A bounded copy carries
   * marker strings where values were dropped, and writing one back would put them into the cache.
   */
  test("reports whether the copy it sent is the whole value", async () => {
    const huge = { rows: Array.from({ length: 30_000 }, (_, i) => ({ i })) };

    class Big extends Component {
      private provider = this.use(QueryClientProvider);
      user = this.use(Query, () => ({ key: ["big"], fetch: async () => huge }));
      render() {
        void this.provider;
        return <span>{this.user.status}</span>;
      }
    }

    const small = mount(async () => ({ name: "Ada" }));
    const big = render(<Big />);

    try {
      await settle();
      const groups = panel().snapshot().groups;
      // A copy that fitted may be written back; one that hit a bound may not — writing it would
      // put the copy's own "[… budget]" markers into the cache.
      expect(groups[0]!.rows[0]!.value!.editable).toBe(true);
      expect(groups[1]!.rows[0]!.value!.editable).toBe(false);
    } finally {
      small.unmount();
      big.unmount();
    }
  });
});
