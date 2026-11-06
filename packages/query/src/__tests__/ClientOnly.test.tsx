import { Component, created, renderToString, state } from "@ramonda/core";
import type { RamondaNode } from "@ramonda/core";
import { act, render } from "@ramonda/testing-library";
import { beforeEach, describe, expect, test } from "vitest";
import { InfiniteQuery } from "../InfiniteQuery";
import { Query } from "../Query";
import { QueryClientAccess, QueryClientProvider } from "../context";

/**
 * Data only the browser has — IndexedDB, `localStorage`, a file the reader picked.
 *
 * Found by an agent building an app from the docs alone: its tournaments live in IndexedDB, its pages
 * are rendered on the server and baked at build time, and the server has no IndexedDB. A query that
 * fetched there failed; the workaround was a hook of its own holding `enabled` until a client mount.
 * `clientOnly: true` says it where the data is asked for.
 */
let calls = 0;
beforeEach(() => {
  calls = 0;
});

/** Stands for an IndexedDB read: it can only work in a browser, so a server call is a failure. */
async function fromTheBrowser(): Promise<{ name: string }> {
  calls++;
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { name: "ada" };
}

function appWith(clientOnly?: boolean) {
  class Card extends Component {
    private stored = this.use(Query, () => ({
      key: ["stored", String(clientOnly)],
      fetch: fromTheBrowser,
      clientOnly,
    }));
    render(): RamondaNode {
      return <p id="out">{this.stored.isPending ? "pending" : this.stored.data?.name}</p>;
    }
  }
  class App extends Component {
    private provider = this.use(QueryClientProvider);
    render(): RamondaNode {
      return (
        <div id="app">
          <Card />
        </div>
      );
    }
  }
  return App;
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await Promise.resolve();
  });
}

describe("clientOnly: true", () => {
  test("a server render does not fetch, and the page says it is loading", async () => {
    const App = appWith(true);
    const html = await renderToString(<App />);
    expect(calls).toBe(0);
    expect(html).toContain("pending");
  });

  test("the client's first render agrees with the server's, then it fetches", async () => {
    const App = appWith(true);
    const html = await renderToString(<App />);
    const { container } = render(<App />, { hydrate: html });

    // The same markup as the server's, so hydration keeps it rather than throwing it away.
    expect(container.querySelector("#out")!.textContent).toBe("pending");
    await settle();
    expect(container.querySelector("#out")!.textContent).toBe("ada");
    expect(calls).toBe(1);
  });

  test("with no server render at all, it fetches as any query does", async () => {
    const App = appWith(true);
    const { container } = render(<App />);
    await settle();
    expect(container.querySelector("#out")!.textContent).toBe("ada");
    expect(calls).toBe(1);
  });
});

describe("left out, or false", () => {
  test.each([
    ["false", false],
    ["left out", undefined],
  ])("when %s, the server fetches and the data is in the page", async (_how, clientOnly) => {
    const App = appWith(clientOnly);
    const html = await renderToString(<App />);
    expect(calls).toBe(1);
    expect(html).toContain("ada");
  });
});

describe("an infinite query", () => {
  test("takes clientOnly too, and a server render fetches none of its pages", async () => {
    let pages = 0;
    class Feed extends Component {
      private feed = this.use(InfiniteQuery<{ n: number }>, () => ({
        key: ["feed"],
        initialPageParam: 0,
        loadPage: async () => {
          pages++;
          return { n: 1 };
        },
        getNextPageParam: () => undefined,
        clientOnly: true,
      }));
      render(): RamondaNode {
        return <p id="out">{this.feed.isPending ? "pending" : "loaded"}</p>;
      }
    }
    class App extends Component {
      private provider = this.use(QueryClientProvider);
      render(): RamondaNode {
        return <Feed />;
      }
    }
    const html = await renderToString(<App />);
    expect(pages).toBe(0);
    expect(html).toContain("pending");
  });
});

/**
 * Every way a query fetches, not only the first. The guard sat in the mount path alone, so a key that
 * moved during the server render — or an invalidation there — still ran the browser-only fetcher on
 * the server. Found by the final review.
 */
describe("clientOnly: true, on every path that fetches", () => {
  /**
   * An infinite query's next and previous pages go through their own fetch, not the inner query's —
   * so they skipped the guard the inner query has, and a page asked for during the server render ran
   * the browser-only loader there. Found by the review after the guard moved.
   */
  test("an infinite query's next page, asked for during the server render, is not fetched there", async () => {
    let pages = 0;
    class Feed extends Component {
      @created asksForMore(): void {
        void this.feed.fetchNextPage();
      }
      feed = this.use(InfiniteQuery<{ n: number }>, () => ({
        key: ["feed-more"],
        initialPageParam: 0,
        loadPage: async () => {
          pages++;
          return { n: 1 };
        },
        getNextPageParam: () => 1,
        clientOnly: true,
      }));
      render(): RamondaNode {
        return <p>{this.feed.isPending ? "pending" : "loaded"}</p>;
      }
    }
    class App extends Component {
      private provider = this.use(QueryClientProvider);
      render(): RamondaNode {
        return <Feed />;
      }
    }
    await renderToString(<App />);
    expect(pages).toBe(0);
  });

  test("a key that changes during the server render does not fetch there", async () => {
    class Card extends Component {
      @state id = 1;
      private stored = this.use(Query, (self: Card) => ({
        key: ["stored", self.id],
        fetch: fromTheBrowser,
        clientOnly: true,
      }));
      @created async moveKey(): Promise<void> {
        await Promise.resolve();
        this.id = 2;
      }
      render(): RamondaNode {
        return <p>{this.stored.isPending ? "pending" : "loaded"}</p>;
      }
    }
    class App extends Component {
      private provider = this.use(QueryClientProvider);
      render(): RamondaNode {
        return <Card />;
      }
    }
    await renderToString(<App />);
    expect(calls).toBe(0);
  });
});

/**
 * The other two ways a fetch starts, each from the owner's `@created` during a server render: an
 * invalidation of the query's key, and an explicit `refetch()`. The guard sits where every one of
 * them meets — this is what says so, and what fails if it ever moves back beside one call site.
 */
describe("clientOnly: true, invalidated or refetched during the server render", () => {
  test.each([
    ["an invalidation", (card: { invalidate(): void; refetchNow(): void }) => card.invalidate()],
    ["a refetch()", (card: { invalidate(): void; refetchNow(): void }) => card.refetchNow()],
  ])("%s does not fetch there", async (_how, start) => {
    class Card extends Component {
      private access = this.use(QueryClientAccess);
      private stored = this.use(Query, () => ({ key: ["kept"], fetch: fromTheBrowser, clientOnly: true }));
      @created later(): void {
        start(this);
      }
      invalidate(): void {
        this.access.client.invalidate(["kept"]);
      }
      refetchNow(): void {
        void this.stored.refetch();
      }
      render(): RamondaNode {
        return <p>{this.stored.isPending ? "pending" : "loaded"}</p>;
      }
    }
    class App extends Component {
      private provider = this.use(QueryClientProvider);
      render(): RamondaNode {
        return <Card />;
      }
    }
    await renderToString(<App />);
    expect(calls).toBe(0);
  });
});
