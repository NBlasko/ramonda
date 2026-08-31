import { Component } from "@ramonda/core";
import type { RamondaNode } from "@ramonda/core";
import { act, render } from "@ramonda/testing-library";
import { describe, expect, test } from "vitest";
import { QueryClientProvider } from "../context";
import { Query } from "../Query";

const settle = () => act(async () => {});

/**
 * `error` is `unknown`, and this is the file that says why it has to stay that way.
 *
 * A fetcher is app code, and app code rejects with whatever it likes: `throw "not found"` after a
 * validation, a status number, a plain object from a JSON error body, or a real `Error`. Nothing
 * between that rejection and `query.error` narrows it, and nothing should — `serializeError` reduces
 * it for the wire, and its own note lists the same shapes, but the live value is handed over as it
 * came.
 *
 * The reason to pin it: the obvious way to render a failure is `(query.error as Error).message`, and
 * for three of the four shapes below that is `undefined` — an empty failure on screen, in the one
 * place a reader needs words. The framework's own examples were written that way in nine places
 * until this was measured. They now ask `error instanceof Error` first.
 *
 * So this is not a test of a repair. It is the boundary that makes the cast wrong, held still.
 */
describe("what a fetch can reject with", () => {
  const CASES: { label: string; thrown: unknown; type: string; message: string | undefined }[] = [
    { label: "a string", thrown: "not found", type: "string", message: undefined },
    { label: "a number", thrown: 404, type: "number", message: undefined },
    { label: "a plain object", thrown: { code: "E_NOPE" }, type: "object", message: undefined },
    { label: "a real Error", thrown: new Error("a real one"), type: "object", message: "a real one" },
  ];

  for (const { label, thrown, type, message } of CASES) {
    test(`${label} reaches query.error unchanged`, async () => {
      let seen: unknown;
      let hasOwnMessage: string | undefined;

      class Card extends Component {
        private client = this.use(QueryClientProvider);
        private q = this.use(Query, () => ({
          key: ["rejects", label],
          fetch: () => Promise.reject(thrown),
          retry: 0,
        }));

        render(): RamondaNode {
          if (this.q.isError) {
            seen = this.q.error;
            // Deliberately the WRONG read, because what it produces is the point.
            hasOwnMessage = (this.q.error as Error).message;
            return <p id="msg">failed</p>;
          }
          return <p id="msg">loading</p>;
        }
      }

      render(<Card />);
      await settle();
      await settle();

      // Handed over as it came: no wrapping, no normalising.
      expect(seen).toBe(thrown);
      expect(typeof seen).toBe(type);

      // And what the cast makes of it — `undefined` for everything that is not an Error.
      expect(hasOwnMessage).toBe(message);

      // What an app should write instead, and it works for all four.
      const shown = seen instanceof Error ? seen.message : String(seen);
      expect(shown.length).toBeGreaterThan(0);
    });
  }
});
