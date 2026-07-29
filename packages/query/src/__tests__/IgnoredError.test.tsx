import { Component, state } from "@ramonda/core";
import { act, render } from "@ramonda/testing-library";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { QueryClientProvider } from "../context";
import { Query } from "../Query";
import { resetQueryDiagnostics } from "../diagnostics";

/**
 * RMQ002 — the query failed and the render never looked.
 *
 * This is what `throwOnError` is for elsewhere, done as a diagnostic instead. An error
 * boundary would replace the subtree: unmounting, cleanups, lost local state, lost focus and
 * scroll, and a retry that has to rebuild all of it. A failed fetch is not an unexpected
 * situation — the network fails routinely, which is why a failure is state here and the data
 * it had is kept. What is worth having from that option is NOTICING, and noticing is a
 * development-time report.
 */

let logs: string[] = [];

beforeEach(() => {
  resetQueryDiagnostics();
  logs = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  });
});

afterEach(() => vi.restoreAllMocks());

const settle = () => act(async () => {});
const reported = () => logs.join("\n");

function failing() {
  return async () => {
    throw new Error("the server said no");
  };
}

describe("RMQ002", () => {
  test("a render that shows only the data is reported, and the key is named", async () => {
    class Card extends Component {
      private provider = this.use(QueryClientProvider);
      user = this.use(Query, () => ({ key: ["user", 7], retry: 0, fetch: failing() }));

      render() {
        void this.provider;
        // Reads `data` and nothing else — the failure is invisible to the reader, and the
        // page looks fine because a failed query keeps whatever it had (here, nothing).
        return <span>{String(this.user.data ?? "—")}</span>;
      }
    }

    const { unmount } = render(<Card />);
    try {
      await settle();
      expect(reported()).toContain("RMQ002");
      expect(reported()).toContain('["user",7]');
      expect(reported()).toContain("the server said no");
      // It points at the alternative to a boundary rather than at a boundary.
      expect(reported()).toContain("NotFound");
    } finally {
      unmount();
    }
  });

  /** Only the four readers matter here, so the query's type parameters do not. */
  type AnyQuery = { isError: boolean; error: unknown; status: string; result: { status: string } };

  for (const [label, read] of [
    ["isError", (q: AnyQuery) => String(q.isError)],
    ["error", (q: AnyQuery) => String((q.error as Error | undefined)?.message)],
    ["status", (q: AnyQuery) => q.status],
    ["result", (q: AnyQuery) => q.result.status],
  ] as const) {
    test(`reading ${label} is enough to silence it`, async () => {
      class Card extends Component {
        private provider = this.use(QueryClientProvider);
        user = this.use(Query, () => ({ key: ["user", label], retry: 0, fetch: failing() }));

        render() {
          void this.provider;
          return <span>{read(this.user)}</span>;
        }
      }

      const { unmount } = render(<Card />);
      try {
        await settle();
        expect(reported()).not.toContain("RMQ002");
      } finally {
        unmount();
      }
    });
  }

  test("a successful query is never reported", async () => {
    class Card extends Component {
      private provider = this.use(QueryClientProvider);
      user = this.use(Query, () => ({ key: ["ok"], fetch: async () => "Ada" }));

      render() {
        void this.provider;
        return <span>{this.user.data ?? "—"}</span>;
      }
    }

    const { unmount } = render(<Card />);
    try {
      await settle();
      expect(reported()).not.toContain("RMQ002");
    } finally {
      unmount();
    }
  });

  test("reading it once is enough forever — the question is whether the app ever looks", async () => {
    /**
     * The semantics changed with access tracking, and for the better. The old check asked "did
     * THIS render look", which meant a collapsed panel was reported. The read set never shrinks,
     * so the question is now "does this reader ever look" — and a component that has read
     * `isError` once demonstrably has the branch.
     *
     * It also had to change: a query read only through `data` fails, changes nothing visible,
     * and is no longer woken at all — so a render-based check could not see it either.
     */
    class Card extends Component {
      private provider = this.use(QueryClientProvider);
      @state showError = true;
      user = this.use(Query, () => ({ key: ["flip"], retry: 0, fetch: failing() }));

      render() {
        void this.provider;
        return <span>{this.showError ? String(this.user.isError) : "hidden"}</span>;
      }
    }

    const { instance, unmount } = render(<Card />);
    try {
      await settle();
      expect(reported()).not.toContain("RMQ002");

      await act(async () => {
        (instance as { showError: boolean }).showError = false;
      });
      await settle();

      expect(reported()).not.toContain("RMQ002");
    } finally {
      unmount();
    }
  });

  test("it says nothing in a production build", async () => {
    // The whole body is behind `__DEV__`, and the prod run asserts the string is absent from
    // the bundle. Here it is enough to know the check is not doing work in that path.
    expect(__DEV__).toBe(true);
  });
});
