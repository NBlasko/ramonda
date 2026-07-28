import { Component, renderToString } from "@ramonda/core";
import type { RamondaNode, VNode } from "@ramonda/core";
import { act, render, waitFor } from "@ramonda/testing-library";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ServerQueryError } from "../errors";
import { Query } from "../Query";
import { QueryClient } from "../QueryClient";
import { QueryClientProvider } from "../context";

interface User {
  name: string;
}

/**
 * Counts every call across BOTH renders, which is the number these tests are
 * really about: the whole point of carrying data across the boundary is that the
 * client does not ask again.
 */
let calls = 0;

beforeEach(() => {
  calls = 0;
});

async function getUser(): Promise<User> {
  calls++;
  // A macrotask, not a microtask: a resolved promise would settle inside the
  // render's own drain and prove nothing. Core awaits real async work on the
  // server (`commit.ts` registers what a lifecycle returns), and this is what
  // exercises it.
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { name: "ada" };
}

class UserCard extends Component {
  private user = this.use(Query, () => ({
    key: ["user", 1],
    fetch: getUser,
  }));

  render(): RamondaNode {
    if (this.user.isPending) return <p id="out">pending</p>;
    if (this.user.isError) return <p id="out">{(this.user.error as Error).message}</p>;
    return <p id="out">{this.user.data?.name}</p>;
  }
}

class App extends Component {
  private provider = this.use(QueryClientProvider);
  render(): RamondaNode {
    return (
      <div id="app">
        <UserCard />
      </div>
    );
  }
}

/**
 * Lets a MACROTASK through, not just the microtask queue: the fetcher here waits on
 * a `setTimeout`, exactly so these tests exercise the path core added for real async
 * work rather than the one a resolved promise takes.
 */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await Promise.resolve();
  });
}

describe("server rendering", () => {
  test("the data is in the HTML, not a spinner", async () => {
    const html = await renderToString(<App />);

    expect(html).toContain("ada");
    expect(html).not.toContain("pending");
    expect(calls).toBe(1);
  });

  test("the snapshot rides along in the state blob", async () => {
    const html = await renderToString(<App />);

    // No app wiring, no `dehydrate()` call, no script tag: the query's answer is in
    // the hook's own `@state`, which core already serializes per component.
    expect(html).toContain("ada");
    expect(html).toMatch(/data-ramonda-state|ramonda-state/);
  });

  test("`waitFor` is the tool when a real round trip is involved", async () => {
    // The boundary worth showing: `act` commits work already SCHEDULED — it does not
    // wait for a timer, and this fetcher waits on one. `waitFor` retries the
    // assertion, and Ramonda's renders are microtask-batched, so the DOM catches up
    // between attempts with nothing else to arrange.
    class Card extends Component {
      private provider = this.use(QueryClientProvider);
      private user = this.use(Query, () => ({ key: ["user", 9], fetch: getUser }));
      render(): RamondaNode {
        return <p id="out">{this.user.data?.name ?? "pending"}</p>;
      }
    }

    const { container } = render((<Card />) as VNode);

    await act(async () => {});
    expect(container.querySelector("#out")!.textContent).toBe("pending");

    await waitFor(() => {
      expect(container.querySelector("#out")!.textContent).toBe("ada");
    });
  });

  test("the client renders the server's data on its FIRST render, and does not refetch", async () => {
    const html = await renderToString(<App />);
    expect(calls).toBe(1);

    const { container } = render(<App />, { hydrate: html });

    // Before any settling: if the first client render had produced "pending",
    // hydration would have thrown the server's markup away (RMD007) and the reader
    // would watch finished content flash into a spinner.
    expect(container.querySelector("#out")!.textContent).toBe("ada");

    await settle();

    expect(container.querySelector("#out")!.textContent).toBe("ada");
    // Data that came from the server is as fresh as the document that carried it,
    // so the default `staleTime: 0` does not make hydration refetch everything.
    expect(calls).toBe(1);
  });

  test('`refetchOnMount: "always"` does refetch after hydration', async () => {
    class AlwaysCard extends Component {
      private user = this.use(Query, () => ({
        key: ["user", 1],
        fetch: getUser,
        refetchOnMount: "always" as const,
      }));
      render(): RamondaNode {
        return <p id="out">{this.user.data?.name ?? "pending"}</p>;
      }
    }

    class AlwaysApp extends Component {
      private provider = this.use(QueryClientProvider);
      render(): RamondaNode {
        return (
          <div id="app">
            <AlwaysCard />
          </div>
        );
      }
    }

    const html = await renderToString(<AlwaysApp />);
    expect(calls).toBe(1);

    const { container } = render(<AlwaysApp />, { hydrate: html });
    // Still no flash — the server's data is on screen while the refresh runs.
    expect(container.querySelector("#out")!.textContent).toBe("ada");

    await settle();
    expect(calls).toBe(2);
  });

  test("a failure crosses the boundary as a real Error", async () => {
    let seen: unknown;

    class FailingCard extends Component {
      private thing = this.use(Query, () => ({
        key: ["thing"],
        retry: 0,
        fetch: async (): Promise<string> => {
          await new Promise((resolve) => setTimeout(resolve, 0));
          throw new TypeError("bad gateway");
        },
      }));

      render(): RamondaNode {
        seen = this.thing.error;
        return <p id="out">{this.thing.isError ? (this.thing.error as Error).message : "pending"}</p>;
      }
    }

    class FailingApp extends Component {
      private provider = this.use(QueryClientProvider);
      render(): RamondaNode {
        return (
          <div id="app">
            <FailingCard />
          </div>
        );
      }
    }

    const html = await renderToString(<FailingApp />);
    expect(html).toContain("bad gateway");

    const { container } = render(<FailingApp />, { hydrate: html });
    expect(container.querySelector("#out")!.textContent).toBe("bad gateway");

    // `JSON.stringify(new Error("x"))` is `{}`, so this only works because the
    // failure is serialized by hand and rebuilt on arrival.
    expect(seen).toBeInstanceOf(ServerQueryError);
    expect((seen as Error).name).toBe("TypeError");
  });

  test("two components sharing a key make one request on the server", async () => {
    class Pair extends Component {
      private provider = this.use(QueryClientProvider);
      render(): RamondaNode {
        return (
          <div id="app">
            <UserCard />
            <UserCard />
          </div>
        );
      }
    }

    const html = await renderToString(<Pair />);

    expect(calls).toBe(1);
    // Counting the rendered TEXT, not every "ada" in the document: each observer
    // also carries the name in its own state blob, which is the cost of the
    // no-wiring snapshot and is asserted separately below.
    expect(html.match(/>ada</g)?.length).toBe(2);
  });

  test("each observer of a shared key carries its own snapshot", async () => {
    class Pair extends Component {
      private provider = this.use(QueryClientProvider);
      render(): RamondaNode {
        return (
          <div id="app">
            <UserCard />
            <UserCard />
          </div>
        );
      }
    }

    const html = await renderToString(<Pair />);

    // The honest cost of carrying data through `@state`: two observers of one key
    // ship two copies. Bytes, not correctness — and `dehydrate`/`hydrate` is the
    // door for a page that would rather send the cache once.
    const snapshots = html.match(/&quot;name&quot;:&quot;ada&quot;|"name":"ada"/g) ?? [];
    expect(snapshots.length).toBe(2);
  });

  test("a query whose key moved between the two renders ignores the stale snapshot", async () => {
    // The server rendered user 1; the document is hydrated showing user 2 (a client
    // that navigated, or a CDN serving one document for many paths). The server's
    // answer to the old question must not be presented as the answer to the new one.
    class Card extends Component<{ id: number }> {
      private user = this.use(Query, (self: Card) => ({
        key: ["user", self.props.id],
        fetch: getUser,
      }));
      render(): RamondaNode {
        return <p id="out">{this.user.data?.name ?? "pending"}</p>;
      }
    }

    class Page extends Component<{ id: number }> {
      private provider = this.use(QueryClientProvider);
      render(): RamondaNode {
        return (
          <div id="app">
            <Card id={this.props.id} />
          </div>
        );
      }
    }

    const html = await renderToString(<Page id={1} />);
    expect(calls).toBe(1);

    // The mismatch is REAL here, and core is right to report it: the server's
    // markup says "ada" and the client, asking a different question, has nothing
    // yet. The alternative — presenting user 1's name as user 2's — is the outcome
    // worth refusing, so the report is the price of correctness rather than a bug.
    // `console.log`, not `console.error` — that is the channel `ramondaLog` writes
    // on (debug/logger.ts), so it is also the devtools Logs stream.
    const logs = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const { container } = render(<Page id={2} />, { hydrate: html });

      expect(container.querySelector("#out")!.textContent).toBe("pending");
      expect(logs.mock.calls.flat().join(" ")).toContain("RMD007");

      // No data for user 2 yet, so it fetches — rather than showing user 1's name.
      await settle();
      expect(calls).toBe(2);
      expect(container.querySelector("#out")!.textContent).toBe("ada");
    } finally {
      logs.mockRestore();
    }
  });
});

describe("explicit dehydrate / hydrate", () => {
  test("a client prefilled on the server needs no per-query snapshot", async () => {
    // The other door: a server that would rather fetch outside the tree and hand
    // the cache over. Useful for flattening a waterfall — core gives up after ten
    // sequential rounds of async work, and one prefetch above the tree is how a
    // page stays under it.
    const server = new QueryClient();
    await server.prefetch(["user", 1], getUser);
    expect(calls).toBe(1);

    const transferred = JSON.parse(JSON.stringify(server.dehydrate()));
    const client = new QueryClient();
    client.hydrate(transferred);

    class Card extends Component {
      private provider = this.use(QueryClientProvider, () => ({ client }));
      private user = this.use(Query, () => ({ key: ["user", 1], fetch: getUser }));
      render(): RamondaNode {
        return <p id="out">{this.user.data?.name ?? "pending"}</p>;
      }
    }

    const { container, unmount } = render((<Card />) as VNode);
    try {
      expect(container.querySelector("#out")!.textContent).toBe("ada");
      await settle();
      expect(calls).toBe(1);
    } finally {
      unmount();
    }
  });
});

describe("the server does not keep working after the response", () => {
  test("a query started by a render that ended writes nothing more", async () => {
    // Core closes its work collector when the render finishes, and drops updates
    // scheduled into a tree nobody will serve. A query resolving late must not
    // fight that — measured here as "no unhandled rejection, no throw".
    const slow = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return "late";
    });

    class Slow extends Component {
      private provider = this.use(QueryClientProvider);
      private thing = this.use(Query, () => ({ key: ["slow"], fetch: slow }));
      render(): RamondaNode {
        return <p id="out">{this.thing.data ?? "pending"}</p>;
      }
    }

    const html = await renderToString(<Slow />);
    expect(html).toContain("late");

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(slow).toHaveBeenCalledTimes(1);
  });
});
