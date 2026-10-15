import { Component, renderToString } from "@ramonda/core";
import type { RamondaNode } from "@ramonda/core";
import { act, render } from "@ramonda/testing-library";
import { beforeEach, describe, expect, test } from "vitest";
import { InfiniteQuery } from "../InfiniteQuery";
import { Query } from "../Query";
import { QueryClientProvider } from "../context";

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
