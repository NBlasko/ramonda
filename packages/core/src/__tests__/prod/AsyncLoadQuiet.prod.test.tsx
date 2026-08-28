import { describe, test, expect, vi } from "vitest";
import { Component, bootstrap, unmount, AsyncLoad } from "../../index";
import { flushSync } from "../../testing";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * A failed import does not write to the console in PRODUCTION.
 *
 * The failure is already the app's, in the framework's own way: `errorFallback`
 * is handed `{ error, retry, attempt }`, so it can render what it likes, report
 * where it likes, and offer a retry. An unconditional `console.error` beside that
 * is a second channel the app cannot turn off — and a chunk that fails to load is
 * not always an incident. A deploy rotating its assets, a reader going offline, a
 * network that drops one request: apps handle those, and a red line in the console
 * for each is noise they did not ask for.
 *
 * Development keeps it, because there the reason for the failure is what you need
 * and there is no monitoring to send it to. That is the same split `h.ts` makes
 * for a function in tag position.
 */
describe("production: a failed lazy import", () => {
  test("__DEV__ is false in this run", () => {
    expect(__DEV__).toBe(false);
  });

  test("renders the fallback with the error, and says nothing to the console", async () => {
    const errors: unknown[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args);
    });

    let seen: unknown;

    class Page extends Component {
      render() {
        return (
          <div>
            <AsyncLoad
              lazy={() => Promise.reject(new Error("chunk 404"))}
              onLoading={<i>loading…</i>}
              errorFallback={({ error }) => {
                seen = error;
                return <i>could not load</i>;
              }}
              cacheKey="prod-quiet"
            />
          </div>
        );
      }
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    bootstrap(<Page />, container);
    flushSync();
    await tick();
    flushSync();

    // The app was told, with the error itself…
    expect(container.textContent).toBe("could not load");
    expect((seen as Error).message).toBe("chunk 404");

    // …and nothing else was.
    expect(errors).toEqual([]);

    unmount(container);
    container.remove();
    vi.restoreAllMocks();
  });
});
