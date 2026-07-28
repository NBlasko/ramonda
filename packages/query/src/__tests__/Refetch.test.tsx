import { Component, state } from "@ramonda/core";
import type { RamondaNode, VNode } from "@ramonda/core";
import { act, render } from "@ramonda/testing-library";
import { afterEach, describe, expect, test, vi } from "vitest";
import { Query } from "../Query";
import { QueryClient } from "../QueryClient";
import { QueryClientProvider } from "../context";
import type { QueryDefaults } from "../types";

/**
 * Commits everything already scheduled.
 *
 * `act` alone does this — with an async callback it gives the continuations ten
 * microtask turns and flushes after each — so this is a name, not a mechanism. What
 * it does NOT do is wait for a timer or a real round trip; that is `waitFor`, and
 * `Ssr.test.tsx` uses it where it matters.
 */
const settle = () => act(async () => {});

/**
 * A page with one query, whose options the test supplies. Everything here is
 * about WHEN it fetches, so the render is deliberately uninteresting.
 */
function pageWith(fetcher: () => Promise<string>, options: QueryDefaults = {}, client?: QueryClient) {
  class Page extends Component {
    private provider = this.use(QueryClientProvider, () => ({ client }));
    thing = this.use(Query, () => ({ key: ["thing"], fetch: fetcher, ...options }));

    render(): RamondaNode {
      return <p id="out">{this.thing.data ?? this.thing.status}</p>;
    }
  }
  return Page;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("refetchOnMount", () => {
  test("a second mount refreshes stale data by default", async () => {
    const client = new QueryClient();
    const fetcher = vi.fn(async () => "v");
    const Page = pageWith(fetcher, {}, client);

    const first = render((<Page />) as VNode);
    await settle();
    expect(fetcher).toHaveBeenCalledTimes(1);
    first.unmount();

    // staleTime defaults to 0, so what is cached is already stale.
    const second = render((<Page />) as VNode);
    await settle();
    expect(fetcher).toHaveBeenCalledTimes(2);
    second.unmount();
  });

  test("`false` leaves cached data alone", async () => {
    const client = new QueryClient();
    const fetcher = vi.fn(async () => "v");
    const Page = pageWith(fetcher, { refetchOnMount: false }, client);

    const first = render((<Page />) as VNode);
    await settle();
    first.unmount();

    const second = render((<Page />) as VNode);
    await settle();
    expect(fetcher).toHaveBeenCalledTimes(1);
    second.unmount();
  });

  test("`false` still fetches when there is nothing cached", async () => {
    const fetcher = vi.fn(async () => "v");
    const Page = pageWith(fetcher, { refetchOnMount: false });

    const { container, unmount } = render((<Page />) as VNode);
    try {
      await settle();
      // Nothing to refresh is not the same as nothing to fetch.
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(container.querySelector("#out")!.textContent).toBe("v");
    } finally {
      unmount();
    }
  });

  test("`always` refreshes data that is still fresh", async () => {
    const client = new QueryClient({ defaults: { staleTime: Number.POSITIVE_INFINITY } });
    const fetcher = vi.fn(async () => "v");
    const Page = pageWith(fetcher, { refetchOnMount: "always" }, client);

    const first = render((<Page />) as VNode);
    await settle();
    first.unmount();

    const second = render((<Page />) as VNode);
    await settle();
    expect(fetcher).toHaveBeenCalledTimes(2);
    second.unmount();
  });
});

describe("window triggers", () => {
  test("focus refreshes stale data", async () => {
    const fetcher = vi.fn(async () => "v");
    const Page = pageWith(fetcher);

    const { unmount } = render((<Page />) as VNode);
    try {
      await settle();
      expect(fetcher).toHaveBeenCalledTimes(1);

      await act(async () => {
        window.dispatchEvent(new Event("focus"));
        await Promise.resolve();
      });
      await settle();

      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      unmount();
    }
  });

  test("focus leaves fresh data alone", async () => {
    const fetcher = vi.fn(async () => "v");
    const Page = pageWith(fetcher, { staleTime: 60_000 });

    const { unmount } = render((<Page />) as VNode);
    try {
      await settle();
      await act(async () => {
        window.dispatchEvent(new Event("focus"));
        await Promise.resolve();
      });
      await settle();

      // The point of the default: an alt-tab is not a request.
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      unmount();
    }
  });

  test("`refetchOnWindowFocus: false` turns it off", async () => {
    const fetcher = vi.fn(async () => "v");
    const Page = pageWith(fetcher, { refetchOnWindowFocus: false });

    const { unmount } = render((<Page />) as VNode);
    try {
      await settle();
      await act(async () => {
        window.dispatchEvent(new Event("focus"));
        await Promise.resolve();
      });
      await settle();
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      unmount();
    }
  });

  test("coming back online refreshes stale data", async () => {
    const fetcher = vi.fn(async () => "v");
    const Page = pageWith(fetcher);

    const { unmount } = render((<Page />) as VNode);
    try {
      await settle();
      await act(async () => {
        window.dispatchEvent(new Event("online"));
        await Promise.resolve();
      });
      await settle();
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      unmount();
    }
  });

  test("a trigger fires nothing after unmount", async () => {
    const fetcher = vi.fn(async () => "v");
    const Page = pageWith(fetcher);

    const { unmount } = render((<Page />) as VNode);
    await settle();
    unmount();

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });
    // The listener is an effect's, removed by its cleanup on teardown.
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("refetchInterval", () => {
  test("polls, and keeps polling", async () => {
    // Only the interval is faked. Faking the microtask queue as well would take
    // over the framework's own update batching, and this test would then be about
    // the fake timer rather than about polling.
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });

    const fetcher = vi.fn(async () => "v");
    const Page = pageWith(fetcher, { refetchInterval: 1000 });

    const { unmount } = render((<Page />) as VNode);
    try {
      await settle();
      expect(fetcher).toHaveBeenCalledTimes(1);

      await act(async () => {
        vi.advanceTimersByTime(1000);
        await Promise.resolve();
      });
      await settle();
      expect(fetcher).toHaveBeenCalledTimes(2);

      await act(async () => {
        vi.advanceTimersByTime(1000);
        await Promise.resolve();
      });
      await settle();
      expect(fetcher).toHaveBeenCalledTimes(3);
    } finally {
      unmount();
    }
  });

  test("polling ignores staleTime — the interval IS the policy", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });

    const fetcher = vi.fn(async () => "v");
    const Page = pageWith(fetcher, { refetchInterval: 1000, staleTime: Number.POSITIVE_INFINITY });

    const { unmount } = render((<Page />) as VNode);
    try {
      await settle();
      await act(async () => {
        vi.advanceTimersByTime(1000);
        await Promise.resolve();
      });
      await settle();
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      unmount();
    }
  });

  test("the interval is cleared on unmount", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });

    const fetcher = vi.fn(async () => "v");
    const Page = pageWith(fetcher, { refetchInterval: 1000 });

    const { unmount } = render((<Page />) as VNode);
    await settle();
    unmount();

    await act(async () => {
      vi.advanceTimersByTime(5000);
      await Promise.resolve();
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test("changing the interval replaces the timer instead of adding one", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const fetcher = vi.fn(async () => "v");

    class Page extends Component {
      private provider = this.use(QueryClientProvider);
      @state every = 1000;
      private thing = this.use(Query, (self: Page) => ({
        key: ["thing"],
        fetch: fetcher,
        refetchInterval: self.every,
      }));

      render(): RamondaNode {
        return <p id="out">{this.thing.data ?? "…"}</p>;
      }
    }

    const { unmount, instance } = render<Page>((<Page />) as VNode);
    try {
      await settle();
      expect(fetcher).toHaveBeenCalledTimes(1);

      await act(async () => {
        instance.every = 5000;
      });
      await settle();

      // The old 1s timer is gone with the effect's cleanup, so this does nothing.
      await act(async () => {
        vi.advanceTimersByTime(4999);
        await Promise.resolve();
      });
      await settle();
      expect(fetcher).toHaveBeenCalledTimes(1);

      await act(async () => {
        vi.advanceTimersByTime(1);
        await Promise.resolve();
      });
      await settle();
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      unmount();
    }
  });
});
