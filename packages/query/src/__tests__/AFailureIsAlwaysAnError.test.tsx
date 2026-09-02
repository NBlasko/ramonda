import { Component } from "@ramonda/core";
import type { RamondaNode } from "@ramonda/core";
import { act, render } from "@ramonda/testing-library";
import { describe, expect, test } from "vitest";
import { QueryClientProvider } from "../context";
import { Query } from "../Query";

const settle = () => act(async () => {});

/**
 * `query.error` is an `Error`, whatever the fetcher rejected with.
 *
 * A fetcher is app code and rejects with what it likes: `throw "not found"` after a validation, a
 * status number, a plain object parsed out of a JSON error body. All of those used to arrive exactly
 * as thrown, `error` was `unknown`, and every example in this repository wrote
 * `(error as Error).message` — which is `undefined` for three of those four shapes, so the page
 * rendered an EMPTY failure in the one place a reader needs words.
 *
 * Typing it `Error` without making it one would only have hidden that: a visible cast becomes an
 * invisible `undefined`. So the rejection is normalised where it is caught, and this file is the
 * contract that says so.
 *
 * The other half of the reason is consistency. A failure restored from a server render came back as
 * `ServerQueryError` — a real `Error` — while the same failure fetched on the client came back as
 * whatever was thrown, so identical app code behaved differently depending on whether the page was
 * server-rendered.
 */
describe("a failure is always an Error", () => {
  const CASES: { label: string; thrown: unknown; message: string }[] = [
    { label: "a string", thrown: "not found", message: "not found" },
    { label: "a number", thrown: 404, message: "404" },
    { label: "a plain object", thrown: { code: "E_NOPE" }, message: "[object Object]" },
    { label: "undefined, from a bare throw", thrown: undefined, message: "undefined" },
  ];

  for (const { label, thrown, message } of CASES) {
    test(`${label} arrives as an Error, with the original on cause`, async () => {
      let seen: Error | undefined;

      class Card extends Component {
        private client = this.use(QueryClientProvider);
        private q = this.use(Query, () => ({
          key: ["rejects", label],
          fetch: () => Promise.reject(thrown),
          retry: 0,
        }));

        render(): RamondaNode {
          if (this.q.isError) seen = this.q.error;
          return <p id="msg">{this.q.error?.message ?? "loading"}</p>;
        }
      }

      const { container } = render(<Card />);
      await settle();
      await settle();

      expect(seen).toBeInstanceOf(Error);
      expect(seen?.message).toBe(message);
      // Nothing is lost: what the fetcher actually threw is still reachable.
      expect(seen?.cause).toBe(thrown);

      // And the read an app writes — no cast, no helper — says something for every shape.
      expect(container.querySelector("#msg")!.textContent).toBe(message);
    });
  }

  /**
   * A real `Error` is passed through as ITSELF, not wrapped.
   *
   * Wrapping one would break `instanceof MyApiError` in an app that throws its own subclass, and put
   * the thing a reader wants one `cause` deeper for no gain.
   */
  test("an Error the fetcher threw is the same object, not a copy", async () => {
    const thrown = new TypeError("a real one");
    let seen: Error | undefined;

    class Card extends Component {
      private client = this.use(QueryClientProvider);
      private q = this.use(Query, () => ({ key: ["rejects", "real"], fetch: () => Promise.reject(thrown), retry: 0 }));
      render(): RamondaNode {
        if (this.q.isError) seen = this.q.error;
        return <p id="msg">{this.q.error?.message ?? "loading"}</p>;
      }
    }

    render(<Card />);
    await settle();
    await settle();

    expect(seen).toBe(thrown);
    expect(seen).toBeInstanceOf(TypeError);
    expect(seen?.cause).toBeUndefined();
  });
});
