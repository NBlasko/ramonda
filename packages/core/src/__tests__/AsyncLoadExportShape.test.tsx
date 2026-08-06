import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { getDOM } from "../test/setup";
import { Component, Host } from "../index";
import { AsyncLoad } from "../base/AsyncLoad";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * A module that loads fine but has nothing to render.
 *
 * `AsyncLoad` caches the export and later calls it — a class is wrapped, anything
 * else is taken as already callable. An export that is neither reached the cache
 * unchecked, and the failure surfaced one render later, from a line that knows
 * nothing about the module: "loadedComponent is not a function". The error
 * fallback never appeared, because nothing had failed as far as the loading
 * knew; the render simply threw.
 *
 * The mistake is ordinary — a default export that is a config object, a `styles`
 * module, a barrel file, a named export pointing at a constant. It is the same
 * class of mistake as a missing named export, which this file has always caught
 * at load time and reported through the error fallback. This makes the two agree.
 */
describe("a module whose export is not something to render", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  test("a plain object default export goes to the error fallback", async () => {
    let seen = "";

    @Host("div")
    class App extends Component {
      render() {
        return (
          <AsyncLoad
            lazy={() => Promise.resolve({ default: { colour: "red" } })}
            onLoading={<i>loading…</i>}
            errorFallback={({ error }) => {
              seen = error instanceof Error ? error.message : String(error);
              return <i>could not load</i>;
            }}
            cacheKey="shape-object"
          />
        );
      }
    }

    const app = await getDOM<App>(<App />);
    await app.settle();
    await tick();
    await app.settle();

    expect(app.container.textContent).toBe("could not load");
    // The message has to name what was found, or it is the same puzzle as before
    // with a different sentence.
    expect(seen).toContain("default");
    expect(seen).toContain("object");
  });

  test("a named export that is not a component says which name it was", async () => {
    let seen = "";

    @Host("div")
    class App extends Component {
      render() {
        return (
          <AsyncLoad
            lazy={() => Promise.resolve({ Widget: 42 })}
            namedExport="Widget"
            onLoading={<i>loading…</i>}
            errorFallback={({ error }) => {
              seen = error instanceof Error ? error.message : String(error);
              return <i>could not load</i>;
            }}
            cacheKey="shape-number"
          />
        );
      }
    }

    const app = await getDOM<App>(<App />);
    await app.settle();
    await tick();
    await app.settle();

    expect(app.container.textContent).toBe("could not load");
    expect(seen).toContain("Widget");
    expect(seen).toContain("number");
  });

  test("a function export still loads — this is not a components-only rule", async () => {
    @Host("div")
    class App extends Component {
      render() {
        return (
          <AsyncLoad
            lazy={() => Promise.resolve({ default: () => <b>from a function</b> })}
            onLoading={<i>loading…</i>}
            errorFallback={<i>could not load</i>}
            cacheKey="shape-function"
          />
        );
      }
    }

    const app = await getDOM<App>(<App />);
    await app.settle();
    await tick();
    await app.settle();

    expect(app.container.textContent).toBe("from a function");
  });
});
