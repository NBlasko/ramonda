import { Component, list, state } from "@ramonda/core";
import { act, render } from "@ramonda/testing-library";
import { describe, expect, test, vi } from "vitest";
import { QueryClientProvider } from "../context";
import { InfiniteQuery } from "../InfiniteQuery";
import { infiniteQueryOptions } from "../options";
import type { PageContext } from "../types";

/**
 * Pages under one key.
 *
 * The tests below measure the four things that make this more than a loop: the whole list
 * lives in ONE cache entry (so a prefix invalidate means "this list is stale"), a refresh
 * reloads every page it already has rather than resetting to page one, `hasNextPage` comes
 * from the app's own `getNextPageParam`, and adding a page goes through the ordinary fetch
 * path — so it is deduplicated and abortable like anything else.
 */

interface Page {
  items: string[];
  next: number | undefined;
}

const settle = () => act(async () => {});

/** Three pages of two items, with a cursor that runs out — the server, in effect. */
function makeServer() {
  const calls: unknown[] = [];
  const pages: Record<number, Page> = {
    0: { items: ["a", "b"], next: 1 },
    1: { items: ["c", "d"], next: 2 },
    2: { items: ["e"], next: undefined },
  };
  let revision = 0;

  return {
    calls,
    bump() {
      revision++;
    },
    load(ctx: PageContext): Promise<Page> {
      const cursor = ctx.pageParam as number;
      calls.push(cursor);
      const page = pages[cursor]!;
      return Promise.resolve(revision === 0 ? page : { ...page, items: page.items.map((i) => `${i}${revision}`) });
    },
  };
}

function mountFeed(server: ReturnType<typeof makeServer>, options?: { maxPages?: number }) {
  class Feed extends Component {
    private provider = this.use(QueryClientProvider);
    @state renders = 0;

    /**
     * Through `infiniteQueryOptions`, so `getNextPageParam`'s parameter is typed. Written
     * as a plain object literal it is an implicit `any`: `TPage` comes from `loadPage`, and
     * nothing flows between two properties of the same literal. Measured — that is what
     * this helper exists for.
     */
    feed = this.use(InfiniteQuery, () =>
      infiniteQueryOptions({
        key: ["posts"],
        initialPageParam: 0,
        loadPage: server.load,
        getNextPageParam: (last) => last.next,
        maxPages: options?.maxPages,
      }),
    );

    renderPage(page: Page) {
      return <li>{page.items.join(",")}</li>;
    }

    render() {
      void this.provider;
      return (
        <div>
          <ul id="pages">{list({ each: this.feed.pages, render: this.renderPage })}</ul>
          <span id="state">
            {`${this.feed.status}|next:${this.feed.hasNextPage}|adding:${this.feed.isFetchingNextPage}`}
          </span>
        </div>
      );
    }
  }

  return render(<Feed />);
}

function pagesOf(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("#pages li")).map((li) => li.textContent ?? "");
}

function stateOf(container: HTMLElement): string {
  return container.querySelector("#state")!.textContent ?? "";
}

describe("InfiniteQuery", () => {
  test("loads the first page, then appends", async () => {
    const server = makeServer();
    const { container, instance, unmount } = mountFeed(server);

    try {
      await settle();
      expect(pagesOf(container)).toEqual(["a,b"]);
      expect(stateOf(container)).toBe("success|next:true|adding:false");

      await act(async () => {
        await (instance as { feed: InfiniteQuery<Page> }).feed.fetchNextPage();
      });
      expect(pagesOf(container)).toEqual(["a,b", "c,d"]);

      await act(async () => {
        await (instance as { feed: InfiniteQuery<Page> }).feed.fetchNextPage();
      });
      expect(pagesOf(container)).toEqual(["a,b", "c,d", "e"]);

      // The app's `getNextPageParam` returned undefined for the last page, which is the
      // only end-of-list signal there is.
      expect(stateOf(container)).toBe("success|next:false|adding:false");
      expect(server.calls).toEqual([0, 1, 2]);
    } finally {
      unmount();
    }
  });

  test("fetchNextPage past the end changes nothing and asks for nothing", async () => {
    const server = makeServer();
    const { container, instance, unmount } = mountFeed(server);

    try {
      await settle();
      const feed = (instance as { feed: InfiniteQuery<Page> }).feed;
      await act(async () => {
        await feed.fetchNextPage();
      });
      await act(async () => {
        await feed.fetchNextPage();
      });
      const before = server.calls.length;

      await act(async () => {
        await feed.fetchNextPage();
      });

      expect(server.calls.length).toBe(before);
      expect(pagesOf(container)).toEqual(["a,b", "c,d", "e"]);
    } finally {
      unmount();
    }
  });

  test("a refresh reloads every page it has, in order", async () => {
    const server = makeServer();
    const { container, instance, unmount } = mountFeed(server);

    try {
      await settle();
      const feed = (instance as { feed: InfiniteQuery<Page> }).feed;
      await act(async () => {
        await feed.fetchNextPage();
      });
      expect(pagesOf(container)).toEqual(["a,b", "c,d"]);

      server.bump();
      server.calls.length = 0;

      await act(async () => {
        await feed.refetch();
      });

      /**
       * Both pages, and the params in the order they were loaded with. Reloading only the
       * first would leave page 2 from before the change — a list that never existed on the
       * server.
       */
      expect(server.calls).toEqual([0, 1]);
      expect(pagesOf(container)).toEqual(["a1,b1", "c1,d1"]);
    } finally {
      unmount();
    }
  });

  test("the whole list is ONE entry, so a prefix invalidate refreshes it", async () => {
    const server = makeServer();
    const { container, instance, unmount } = mountFeed(server);

    try {
      await settle();
      const owner = instance as {
        feed: InfiniteQuery<Page>;
        provider: { client: { all(): unknown[]; invalidate(key: unknown[]): void } };
      };
      await act(async () => {
        await owner.feed.fetchNextPage();
      });

      // Two pages, one entry — that is what makes the invalidate below mean what it says.
      expect(owner.provider.client.all().length).toBe(1);

      server.bump();
      await act(async () => {
        owner.provider.client.invalidate(["posts"]);
      });
      await settle();

      expect(pagesOf(container)).toEqual(["a1,b1", "c1,d1"]);
    } finally {
      unmount();
    }
  });

  test("maxPages drops from the far end", async () => {
    const server = makeServer();
    const { container, instance, unmount } = mountFeed(server, { maxPages: 2 });

    try {
      await settle();
      const feed = (instance as { feed: InfiniteQuery<Page> }).feed;
      await act(async () => {
        await feed.fetchNextPage();
      });
      await act(async () => {
        await feed.fetchNextPage();
      });

      // Three pages were fetched; the oldest was dropped when the third arrived.
      expect(server.calls).toEqual([0, 1, 2]);
      expect(pagesOf(container)).toEqual(["c,d", "e"]);
    } finally {
      unmount();
    }
  });

  test("a second fetchNextPage while one is in flight is dropped, not queued", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const calls: number[] = [];
    class Feed extends Component {
      private provider = this.use(QueryClientProvider);

      feed = this.use(InfiniteQuery, () => ({
        key: ["gated"],
        initialPageParam: 0,
        loadPage: async (ctx: PageContext) => {
          const cursor = ctx.pageParam as number;
          calls.push(cursor);
          if (cursor > 0) await gate;
          return { items: [`p${cursor}`], next: cursor + 1 };
        },
        getNextPageParam: (last: Page) => last.next,
      }));

      render() {
        void this.provider;
        return <span id="out">{`${this.feed.pages.length}|${this.feed.isFetchingNextPage}`}</span>;
      }
    }

    const { container, instance, unmount } = render(<Feed />);

    try {
      await settle();
      expect(container.querySelector("#out")!.textContent).toBe("1|false");

      const feed = (instance as { feed: InfiniteQuery<Page> }).feed;
      const first = feed.fetchNextPage();
      await settle();
      expect(container.querySelector("#out")!.textContent).toBe("1|true");

      // While the first is gated, a second ask is dropped — a "load more" button that is
      // clicked twice must not add the same page twice.
      const second = feed.fetchNextPage();
      release();
      await act(async () => {
        await Promise.all([first, second]);
      });

      expect(calls).toEqual([0, 1]);
      expect(container.querySelector("#out")!.textContent).toBe("2|false");
    } finally {
      unmount();
    }
  });

  test("two components watching one list share the entry and the request", async () => {
    const server = makeServer();

    class Feed extends Component<{ label: string }> {
      feed = this.use(InfiniteQuery, () => ({
        key: ["posts"],
        initialPageParam: 0,
        loadPage: server.load,
        getNextPageParam: (last: Page) => last.next,
      }));

      render() {
        return <span className="feed">{`${this.props.label}:${this.feed.pages.length}`}</span>;
      }
    }

    class App extends Component {
      private provider = this.use(QueryClientProvider);
      render() {
        void this.provider;
        return (
          <div>
            <Feed label="one" />
            <Feed label="two" />
          </div>
        );
      }
    }

    const { container, unmount } = render(<App />);

    try {
      await settle();
      // One request for two observers, and both see the same page count.
      expect(server.calls).toEqual([0]);
      expect(Array.from(container.querySelectorAll(".feed")).map((n) => n.textContent)).toEqual(["one:1", "two:1"]);
    } finally {
      unmount();
    }
  });

  test("enabled: false fetches nothing and stays pending", async () => {
    const load = vi.fn(async () => ({ items: ["x"], next: undefined }) as Page);

    class Feed extends Component {
      private provider = this.use(QueryClientProvider);
      @state ready = false;

      feed = this.use(InfiniteQuery, (self: Feed) => ({
        key: ["gated", self.ready],
        initialPageParam: 0,
        loadPage: load,
        getNextPageParam: (last: Page) => last.next,
        enabled: self.ready,
      }));

      render() {
        void this.provider;
        return <span id="out">{`${this.feed.status}|${this.feed.pages.length}`}</span>;
      }
    }

    const { container, instance, unmount } = render(<Feed />);

    try {
      await settle();
      expect(load).not.toHaveBeenCalled();
      expect(container.querySelector("#out")!.textContent).toBe("pending|0");

      // Asking for a page while disabled is a no-op too.
      await act(async () => {
        await (instance as { feed: InfiniteQuery<Page> }).feed.fetchNextPage();
      });
      expect(load).not.toHaveBeenCalled();

      await act(async () => {
        (instance as { ready: boolean }).ready = true;
      });
      await settle();

      expect(load).toHaveBeenCalledTimes(1);
      expect(container.querySelector("#out")!.textContent).toBe("success|1");
    } finally {
      unmount();
    }
  });

  test("a failing page leaves the pages that arrived, and reports the error", async () => {
    let attempt = 0;
    class Feed extends Component {
      private provider = this.use(QueryClientProvider);

      feed = this.use(InfiniteQuery, () => ({
        key: ["flaky"],
        initialPageParam: 0,
        retry: 0,
        loadPage: async (ctx: PageContext) => {
          const cursor = ctx.pageParam as number;
          attempt++;
          if (cursor === 1) throw new Error("page 2 is broken");
          return { items: [`p${cursor}`], next: cursor + 1 } as Page;
        },
        getNextPageParam: (last: Page) => last.next,
      }));

      render() {
        void this.provider;
        return (
          <span id="out">{`${this.feed.status}|${this.feed.pages.length}|${(this.feed.error as Error | undefined)?.message ?? "-"}`}</span>
        );
      }
    }

    const { container, instance, unmount } = render(<Feed />);

    try {
      await settle();
      expect(container.querySelector("#out")!.textContent).toBe("success|1|-");

      await act(async () => {
        await (instance as { feed: InfiniteQuery<Page> }).feed.fetchNextPage();
      });

      /**
       * The failed append does not throw away page 1: a query in error keeps the data it
       * had, which is the same contract an ordinary `Query` has for a failed refetch.
       */
      expect(container.querySelector("#out")!.textContent).toBe("error|1|page 2 is broken");
      expect(attempt).toBe(2);
    } finally {
      unmount();
    }
  });
});
