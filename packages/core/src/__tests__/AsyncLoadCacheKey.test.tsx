import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { getDOM } from "../test/setup";
import { Component, Host, state } from "../index";
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

  test("two lazies that NAME the same module share it, and nothing is reported", async () => {
    /**
     * The case the claim-by-identity version got wrong, and the common one: the
     * same `import()` written twice — two components each lazy-loading the same
     * chart, a route table listing a page twice. Two different function objects,
     * identical source, and the source NAMES the module, so it identifies it.
     *
     * Told apart by identity they would have looked like a collision: a second
     * cache entry, a second loading frame, and a diagnostic accusing correct code.
     * The source is the right answer here — it is only wrong when it names nothing.
     */
    @Host("div")
    class One extends Component {
      render() {
        return (
          <AsyncLoad lazy={() => import("./fixtures/LazyThing")} onLoading={<i>…</i>} errorFallback={<i>failed</i>} />
        );
      }
    }

    @Host("div")
    class Two extends Component {
      render() {
        return (
          <AsyncLoad lazy={() => import("./fixtures/LazyThing")} onLoading={<i>…</i>} errorFallback={<i>failed</i>} />
        );
      }
    }

    @Host("div")
    class Page extends Component {
      render() {
        return (
          <div>
            <One />
            <Two />
          </div>
        );
      }
    }

    const app = await getDOM(<Page />);
    // A real module, so a real resolution: more turns than a resolved promise takes.
    for (let i = 0; i < 6; i++) {
      await tick();
      await app.settle();
    }

    expect(app.container.querySelectorAll("span").length).toBe(2);
    expect(logged.filter((line) => line.includes("RMD035"))).toEqual([]);
  });

  test("one arriving LATER is corrected, not left on the cached module", async () => {
    /**
     * The other half of the same fault, and the one a race does not cover: the
     * first has finished and cached before the second mounts, so the second never
     * loads at all — it finds a hit under the same derived key and renders it.
     *
     * A hit by a different function is therefore not trusted. The module is loaded
     * and COMPARED, which the module registry serves without a fetch, and a module
     * that turns out to be a different one takes a key of its own. The cost is one
     * frame of the wrong module; what it buys is the right one arriving at all,
     * where before it never did.
     */
    @Host("i")
    class Alpha extends Component {
      render() {
        return <span>alpha</span>;
      }
    }
    @Host("i")
    class Beta extends Component {
      render() {
        return <span>beta</span>;
      }
    }

    const make = (module: unknown) => () => Promise.resolve({ default: module });

    @Host("div")
    class Page extends Component {
      @state showSecond = false;
      render() {
        return (
          <div>
            <AsyncLoad lazy={make(Alpha)} onLoading={<i>…</i>} errorFallback={<i>failed</i>} />
            {this.showSecond ? (
              <AsyncLoad lazy={make(Beta)} onLoading={<i>…</i>} errorFallback={<i>failed</i>} />
            ) : null}
          </div>
        );
      }
    }

    const app = await getDOM<Page>(<Page />);
    await app.settle();
    await tick();
    await app.settle();
    expect(app.container.textContent).toContain("alpha");

    // Second one mounts into a cache that is already full, under its key.
    app.instance.showSecond = true;
    for (let i = 0; i < 4; i++) {
      await tick();
      await app.settle();
    }

    expect(app.container.textContent).toContain("alpha");
    expect(app.container.textContent).toContain("beta");
    expect(logged.filter((line) => line.includes("RMD035")).length).toBeGreaterThan(0);
  });

  test("the same lazy handed to two of them still shares one entry", async () => {
    // Nothing names a module here, so both get a minted key — but it is minted per
    // FUNCTION, and this is one function, so the two still share what they load.
    @Host("i")
    class Thing extends Component {
      render() {
        return <span>shared</span>;
      }
    }

    const lazy = () => Promise.resolve({ default: Thing });

    @Host("div")
    class Page extends Component {
      render() {
        return (
          <div>
            <AsyncLoad lazy={lazy} onLoading={<i>…</i>} errorFallback={<i>failed</i>} />
            <AsyncLoad lazy={lazy} onLoading={<i>…</i>} errorFallback={<i>failed</i>} />
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

    expect(app.container.querySelectorAll("span").length).toBe(2);
    expect(app.container.textContent).toContain("shared");
  });
});
