import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { getDOM } from "../test/setup";
import { Component, Host } from "../index";
import { AsyncLoad } from "../base/AsyncLoad";
import { resetDiagnostics } from "../debug/diagnostics";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Two lazies built by the same factory must not share a cache entry.
 *
 * The key is derived from the SOURCE of the `lazy` function, which is right for
 * `() => import("./Thing")` — two different imports read differently. It is wrong
 * for `const make = (path) => () => import(path)`: the value each closed over is
 * not part of the source, so every module the factory builds gets the same key.
 * The first loads and caches; the second never asks for its own and renders the
 * first one's module. Nothing fails, nothing is logged, and which module you get
 * depends on which rendered first.
 *
 * A source with no literal specifier cannot identify anything, so it is not used
 * as an identity at all: that instance gets a key of its own. The cost is that two
 * such lazies do not share a cache entry — the module system still dedupes the
 * fetch — and the diagnostic says how to get the sharing back.
 */
describe("a lazy whose source does not name a module", () => {
  const logged: string[] = [];

  beforeEach(() => {
    logged.length = 0;
    resetDiagnostics();
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  test("two modules from one factory each render their own", async () => {
    @Host("i")
    class Dashboard extends Component {
      render() {
        return <span>dashboard</span>;
      }
    }
    @Host("i")
    class Settings extends Component {
      render() {
        return <span>settings</span>;
      }
    }

    // The shape that breaks it: the specifier is a closed-over value, so both
    // functions stringify identically.
    const make = (module: unknown) => () => Promise.resolve({ default: module });

    @Host("div")
    class Page extends Component {
      render() {
        return (
          <div>
            <AsyncLoad lazy={make(Dashboard)} onLoading={<i>…</i>} errorFallback={<i>failed</i>} />
            <AsyncLoad lazy={make(Settings)} onLoading={<i>…</i>} errorFallback={<i>failed</i>} />
          </div>
        );
      }
    }

    const app = await getDOM(<Page />);
    await app.settle();
    await tick();
    await app.settle();
    await tick();
    await app.settle();

    // Each one its own. Before this, both said "dashboard".
    expect(app.container.textContent).toContain("dashboard");
    expect(app.container.textContent).toContain("settings");
  });

  test("and it is reported, with the way to get the sharing back", async () => {
    @Host("i")
    class Thing extends Component {
      render() {
        return <span>thing</span>;
      }
    }

    const make = (module: unknown) => () => Promise.resolve({ default: module });

    @Host("div")
    class Page extends Component {
      render() {
        return <AsyncLoad lazy={make(Thing)} onLoading={<i>…</i>} errorFallback={<i>failed</i>} />;
      }
    }

    const app = await getDOM(<Page />);
    await app.settle();

    expect(logged.filter((line) => line.includes("RMD035")).length).toBeGreaterThan(0);
    expect(logged.some((line) => line.includes("cacheKey"))).toBe(true);
  });

  test("an ordinary lazy is untouched — same source, one entry, no report", async () => {
    @Host("i")
    class Thing extends Component {
      render() {
        return <span>thing</span>;
      }
    }

    // A literal specifier is what the derived key is for. `import()` cannot be
    // used in a test, so this stands for the shape: a source that names its module.
    const lazy = () => Promise.resolve({ default: Thing }); /* import("./Thing") */

    @Host("div")
    class Page extends Component {
      render() {
        return (
          <div>
            <AsyncLoad cacheKey="./Thing" lazy={lazy} onLoading={<i>…</i>} errorFallback={<i>failed</i>} />
            <AsyncLoad cacheKey="./Thing" lazy={lazy} onLoading={<i>…</i>} errorFallback={<i>failed</i>} />
          </div>
        );
      }
    }

    const app = await getDOM(<Page />);
    await app.settle();
    await tick();
    await app.settle();

    expect(app.container.textContent).toContain("thing");
    expect(logged.filter((line) => line.includes("RMD035"))).toEqual([]);
  });
});
