import { Component, state } from "@ramonda/core";
import { act, render } from "@ramonda/testing-library";
import { describe, expect, test, vi } from "vitest";
import { QueryClientProvider } from "../context";
import { Query } from "../Query";
import { QueryClient } from "../QueryClient";

/**
 * `initialData` and `placeholderData` — and the difference between them is the reason both
 * exist.
 *
 * Initial data IS the answer until something better arrives: it goes in the cache, every
 * observer of the key sees it, and staleness applies to it. Placeholder data is a stand-in one
 * component shows instead of a spinner: never cached, gone the moment the fetch lands.
 */

const settle = () => act(async () => {});

describe("initialData", () => {
  test("is in the cache, so the first render has it and other observers see it", async () => {
    const fetcher = vi.fn(async () => "fetched");

    class Twin extends Component<{ label: string }> {
      q = this.use(Query, () => ({ key: ["seeded"], fetch: fetcher, initialData: "seeded", staleTime: 60_000 }));
      render() {
        return <span className="twin">{`${this.props.label}:${this.q.data ?? "—"}`}</span>;
      }
    }

    class App extends Component {
      provider = this.use(QueryClientProvider);
      render() {
        void this.provider;
        return (
          <div>
            <Twin label="a" />
            <Twin label="b" />
          </div>
        );
      }
    }

    const app = render(<App />);
    try {
      // Present on the FIRST render, before anything settles — it is seeded from the read path.
      expect(Array.from(app.container.querySelectorAll(".twin")).map((n) => n.textContent)).toEqual([
        "a:seeded",
        "b:seeded",
      ]);

      await settle();
      // Fresh for a minute, so nothing was fetched.
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      app.unmount();
    }
  });

  test("staleness applies to it: with the default staleTime it is refreshed at once", async () => {
    const fetcher = vi.fn(async () => "fetched");

    class Card extends Component {
      provider = this.use(QueryClientProvider);
      q = this.use(Query, () => ({ key: ["stale-seed"], fetch: fetcher, initialData: "seeded" }));
      render() {
        void this.provider;
        return <span id="out">{this.q.data ?? "—"}</span>;
      }
    }

    const app = render(<Card />);
    try {
      expect(app.container.querySelector("#out")!.textContent).toBe("seeded");
      await settle();

      // `staleTime: 0` means stale on arrival — which is the point of putting it in the cache
      // rather than treating it as a placeholder.
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(app.container.querySelector("#out")!.textContent).toBe("fetched");
    } finally {
      app.unmount();
    }
  });

  test("initialDataUpdatedAt makes old data old", async () => {
    const client = new QueryClient();
    client.seed(["old"], "from storage", Date.now() - 120_000);

    // Two minutes old against a one-minute staleTime: stale, as it should be.
    expect(client.isStale(["old"], 60_000)).toBe(true);
    expect(client.isStale(["old"], 300_000)).toBe(false);
  });

  test("it never overwrites an answer that is already there", async () => {
    const client = new QueryClient();
    await client.fetch(["taken"], async () => "fetched");

    client.seed(["taken"], "seeded");

    // An answer that was fetched outranks one the app had lying around — which is also what
    // keeps two observers with their own initialData from fighting.
    expect(client.peek(["taken"])!.data).toBe("fetched");
  });

  test("the function form is called only when the cache is empty", async () => {
    const build = vi.fn(() => "built");
    const client = new QueryClient();
    await client.fetch(["full"], async () => "fetched");

    class Card extends Component {
      provider = this.use(QueryClientProvider, () => ({ client }));
      q = this.use(Query, () => ({ key: ["full"], fetch: async () => "fetched", initialData: build }));
      render() {
        void this.provider;
        return <span>{this.q.data ?? "—"}</span>;
      }
    }

    const app = render(<Card />);
    try {
      await settle();
      // The props callback runs whenever a signal it reads moves; building the value must not.
      expect(build).not.toHaveBeenCalled();
    } finally {
      app.unmount();
    }
  });
});

describe("placeholderData", () => {
  function gated() {
    let resolve!: (value: string) => void;
    const promise = new Promise<string>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  }

  test("shows instead of a spinner, reports itself, and is not cached", async () => {
    const gate = gated();
    const client = new QueryClient();

    class Card extends Component {
      provider = this.use(QueryClientProvider, () => ({ client }));
      q = this.use(Query, () => ({ key: ["ph"], fetch: () => gate.promise, placeholderData: "stand-in" }));
      render() {
        void this.provider;
        return (
          <span id="out">{`${this.q.data ?? "—"}|${this.q.status}|placeholder:${this.q.isPlaceholder}|pending:${this.q.isPending}`}</span>
        );
      }
    }

    const app = render(<Card />);
    try {
      await settle();
      expect(app.container.querySelector("#out")!.textContent).toBe("stand-in|success|placeholder:true|pending:false");

      // The cache holds nothing — that is the whole difference from initialData.
      expect(client.peek(["ph"])!.status).toBe("pending");
      expect(client.peek(["ph"])!.data).toBeUndefined();

      await act(async () => {
        gate.resolve("real");
        await gate.promise;
      });
      await settle();

      expect(app.container.querySelector("#out")!.textContent).toBe("real|success|placeholder:false|pending:false");
    } finally {
      app.unmount();
    }
  });

  test("`result` agrees with the getters", async () => {
    const gate = gated();

    class Card extends Component {
      provider = this.use(QueryClientProvider);
      q = this.use(Query, () => ({ key: ["ph2"], fetch: () => gate.promise, placeholderData: "stand-in" }));
      render() {
        void this.provider;
        const r = this.q.result;
        // Without this the two paths would disagree: `data` would hand back the placeholder
        // while `result` still said pending, and a component narrowing through the union would
        // render the spinner the placeholder exists to replace.
        return <span id="out">{`${r.status}:${r.status === "success" ? r.data : "—"}`}</span>;
      }
    }

    const app = render(<Card />);
    try {
      await settle();
      expect(app.container.querySelector("#out")!.textContent).toBe("success:stand-in");
    } finally {
      app.unmount();
    }
  });

  test("a failure is not hidden by it", async () => {
    class Card extends Component {
      provider = this.use(QueryClientProvider);
      q = this.use(Query, () => ({
        key: ["ph-fail"],
        retry: 0,
        placeholderData: "stand-in",
        fetch: async () => {
          throw new Error("no");
        },
      }));
      render() {
        void this.provider;
        return <span id="out">{`${this.q.status}|${this.q.isPlaceholder}`}</span>;
      }
    }

    const app = render(<Card />);
    try {
      await settle();
      // A placeholder covers "nothing yet", not "it went wrong" — otherwise the failure would
      // be invisible forever.
      expect(app.container.querySelector("#out")!.textContent).toBe("error|false");
    } finally {
      app.unmount();
    }
  });

  test("the function form is built once, not per render", async () => {
    const build = vi.fn(() => "stand-in");
    const gate = gated();

    class Card extends Component {
      provider = this.use(QueryClientProvider);
      @state tick = 0;
      q = this.use(Query, () => ({ key: ["ph3"], fetch: () => gate.promise, placeholderData: build }));
      render() {
        void this.provider;
        return <span id="out">{`${this.q.data}:${this.tick}`}</span>;
      }
    }

    const app = render(<Card />);
    try {
      await settle();
      await act(async () => {
        (app.instance as { tick: number }).tick = 1;
      });
      await settle();

      expect(app.container.querySelector("#out")!.textContent).toBe("stand-in:1");
      expect(build).toHaveBeenCalledTimes(1);
    } finally {
      app.unmount();
    }
  });
});
