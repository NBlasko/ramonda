import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { getDOM } from "../test/setup";
import { Component, state, AsyncLoad } from "../index";
import { markComponents, renderToString } from "../hydration/ssr";
import { hydrateRoot } from "../hydration/hydrate";
import { resetDiagnostics } from "../debug/diagnostics";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

class Loaded extends Component<{ text?: string }> {
  render() {
    return (
      <span>
        <b>[{this.props.text ?? "-"}]</b>
      </span>
    );
  }
}

const injectBlobs = markComponents;

describe("AsyncLoad", () => {
  const codes: string[] = [];
  const handler = (event: Event) => {
    const message = (event as CustomEvent).detail?.message as string;
    const code = message?.match(/^\[(RMD\d+)\]/)?.[1];
    if (code) codes.push(code);
  };

  beforeEach(() => {
    codes.length = 0;
    resetDiagnostics();
    window.addEventListener("ramonda:dev-log", handler);
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    window.removeEventListener("ramonda:dev-log", handler);
    vi.restoreAllMocks();
  });

  test("shows the loading fallback, then the module", async () => {
    let resolveIt: (value: Record<string, unknown>) => void = () => {};

    class App extends Component {
      render() {
        return (
          <div>
            <AsyncLoad
              lazy={() => new Promise((resolve) => (resolveIt = resolve))}
              onLoading={<i>loading…</i>}
              errorFallback={<i>error</i>}
              loadedProps={{ text: "hi" }}
            />
          </div>
        );
      }
    }

    const app = await getDOM<App>(<App />);
    await app.settle();
    expect(app.container.textContent).toBe("loading…");

    resolveIt({ default: Loaded });
    await tick();
    await app.settle();
    expect(app.container.textContent).toBe("[hi]");
  });

  test("a rejected import shows the error fallback", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    class App extends Component {
      render() {
        return (
          <div>
            <AsyncLoad
              lazy={() => Promise.reject(new Error("boom"))}
              onLoading={<i>loading…</i>}
              errorFallback={<i>could not load</i>}
              cacheKey="rejects"
            />
          </div>
        );
      }
    }

    const app = await getDOM<App>(<App />);
    await app.settle();
    await tick();
    await app.settle();
    expect(app.container.textContent).toBe("could not load");
  });

  test("unmounting before the import lands writes nothing", async () => {
    let resolveIt: (value: Record<string, unknown>) => void = () => {};

    class App extends Component {
      @state show = true;
      render() {
        return (
          <div>
            <div>
              {this.show ? (
                <AsyncLoad
                  lazy={() => new Promise((resolve) => (resolveIt = resolve))}
                  onLoading={<i>loading…</i>}
                  errorFallback={<i>error</i>}
                  cacheKey="unmount-race"
                />
              ) : null}
            </div>
          </div>
        );
      }
    }

    const app = await getDOM<App>(<App />);
    await app.settle();
    app.instance.show = false;
    await app.settle();

    resolveIt({ default: Loaded });
    await tick();
    await app.settle();

    // Before the disposed guard this set state on a destroyed component (RMD008).
    expect(codes).toEqual([]);
    expect(app.container.textContent).toBe("");
  });

  test("two AsyncLoads sharing one lazy are not duplicate-keyed", async () => {
    const lazy = () => Promise.resolve({ default: Loaded });

    class App extends Component {
      render() {
        return (
          <div>
            <div>
              <AsyncLoad lazy={lazy} onLoading={<i>L1</i>} errorFallback={<i>E</i>} loadedProps={{ text: "one" }} />
              <AsyncLoad lazy={lazy} onLoading={<i>L2</i>} errorFallback={<i>E</i>} loadedProps={{ text: "two" }} />
            </div>
          </div>
        );
      }
    }

    const app = await getDOM<App>(<App />);
    await app.settle();
    await tick();
    await app.settle();

    expect(app.container.textContent).toBe("[one][two]");
    // The source of `lazy` used to be injected as the vnode key, so both
    // siblings carried the SAME key — RMD002, and a diff that could hand one's
    // node to the other.
    expect(codes).toEqual([]);
  });

  test("a function errorFallback gets a working retry", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    let attempts = 0;
    let seenAttempt = 0;
    let seenMessage = "";

    class App extends Component {
      render() {
        return (
          <div>
            <AsyncLoad
              lazy={() => {
                attempts++;
                // Fails twice, then works.
                return attempts < 3
                  ? Promise.reject(new Error(`attempt ${attempts} failed`))
                  : Promise.resolve({ default: Loaded });
              }}
              onLoading={<i>loading…</i>}
              cacheKey="retry-case"
              loadedProps={{ text: "finally" }}
              errorFallback={({ error, retry, attempt }) => {
                seenAttempt = attempt;
                seenMessage = (error as Error).message;
                return (
                  <button className="retry" onclick={retry}>
                    retry
                  </button>
                );
              }}
            />
          </div>
        );
      }
    }

    const app = await getDOM<App>(<App />);
    await app.settle();
    await tick();
    await app.settle();

    expect(app.container.textContent).toBe("retry");
    expect(seenAttempt).toBe(1);
    expect(seenMessage).toBe("attempt 1 failed");

    const press = async () => {
      (app.container.querySelector(".retry") as HTMLElement).dispatchEvent(new MouseEvent("click"));
      await app.settle();
      await tick();
      await app.settle();
    };

    await press();
    expect(app.container.textContent).toBe("retry");
    expect(seenAttempt).toBe(2);
    expect(seenMessage).toBe("attempt 2 failed");

    await press();
    expect(app.container.textContent).toBe("[finally]");
    expect(attempts).toBe(3);
  });

  test("a plain node errorFallback still works", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    class App extends Component {
      render() {
        return (
          <div>
            <AsyncLoad
              lazy={() => Promise.reject(new Error("nope"))}
              onLoading={<i>loading…</i>}
              errorFallback={<i>plain fallback</i>}
              cacheKey="plain-fallback"
            />
          </div>
        );
      }
    }

    const app = await getDOM<App>(<App />);
    await app.settle();
    await tick();
    await app.settle();
    expect(app.container.textContent).toBe("plain fallback");
  });

  test("the module renders on the server", async () => {
    class App extends Component {
      render() {
        return (
          <div>
            <AsyncLoad
              lazy={() => Promise.resolve({ default: Loaded })}
              onLoading={<i>loading…</i>}
              errorFallback={<i>error</i>}
              loadedProps={{ text: "ssr" }}
              cacheKey="ssr-case"
            />
          </div>
        );
      }
    }

    const html = await renderToString(<App />);
    expect(html).toContain("[ssr]");
  });

  test("hydrating with a restored 'fetched' flag but an empty cache", async () => {
    // The real cross-process case: the server finished loading and says so in
    // its state blob, but the client's module cache is a different process's
    // and knows nothing. Simulated with a lazy that never resolves, so the
    // cache genuinely has no entry, plus a blob that claims it does.
    class App extends Component {
      render() {
        return (
          <div>
            <AsyncLoad
              lazy={() => new Promise<never>(() => {})}
              onLoading={<i>loading…</i>}
              errorFallback={<i>error</i>}
              cacheKey="never-resolves"
            />
          </div>
        );
      }
    }

    const server = await getDOM<App>(<App />);
    await server.settle();
    injectBlobs(server.container);
    const html = server.container.innerHTML.replace(/&quot;isFetched&quot;:false/g, "&quot;isFetched&quot;:true");
    server.unmount();

    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = html;

    // Used to throw "loadedComponent is not a function": render trusted the
    // restored flag and called `cachedFiles.get(key)!` on an empty cache.
    hydrateRoot(<App />, container);
    await tick();

    expect(container.textContent).toBe("loading…");
    container.remove();
  });
});

describe("a changing lazy prop", () => {
  /**
   * The case a router creates: one AsyncLoad instance, pointed at a different
   * module per route.
   *
   * `cacheKey` used to be a `readonly` field computed at construction, so it kept
   * the FIRST module's key forever. The failure is quiet and precise: `render`
   * reads the cache under the stale key and serves the old module, while nothing
   * refetches because `@mounted` already ran. Measured on the docs site — the URL
   * changed, the title changed, and the content stayed on the previous page with
   * no request made.
   */
  class First extends Component {
    render() {
      return (
        <div>
          <p>FIRST</p>
        </div>
      );
    }
  }
  class Second extends Component {
    render() {
      return (
        <div>
          <p>SECOND</p>
        </div>
      );
    }
  }

  class Switcher extends Component {
    @state which: "a" | "b" = "a";

    render() {
      return (
        <div>
          <AsyncLoad
            cacheKey={`switch:${this.which}`}
            lazy={this.which === "a" ? () => Promise.resolve({ Page: First }) : () => Promise.resolve({ Page: Second })}
            namedExport="Page"
            onLoading={<p>loading…</p>}
            errorFallback={<p>failed</p>}
          />
        </div>
      );
    }
  }

  test("loads the new module when the lazy changes", async () => {
    const { instance, container, settle } = await getDOM<Switcher>(<Switcher />);
    await settle();
    expect(container.textContent).toContain("FIRST");

    instance.which = "b";
    await settle();
    await settle();

    expect(container.textContent).toContain("SECOND");
    expect(container.textContent).not.toContain("FIRST");
  });

  test("switching back uses the cache rather than refetching", async () => {
    let fetches = 0;
    const lazyFor = (which: string) => () => {
      fetches++;
      return Promise.resolve({ Page: which === "a" ? First : Second });
    };

    class Counted extends Component {
      @state which: "a" | "b" = "a";
      render() {
        return (
          <div>
            <AsyncLoad
              cacheKey={`counted:${this.which}`}
              lazy={lazyFor(this.which)}
              namedExport="Page"
              onLoading={<p>loading…</p>}
              errorFallback={<p>failed</p>}
            />
          </div>
        );
      }
    }

    const { instance, container, settle } = await getDOM<Counted>(<Counted />);
    await settle();
    const afterFirst = fetches;

    instance.which = "b";
    await settle();
    await settle();
    expect(container.textContent).toContain("SECOND");

    instance.which = "a";
    await settle();
    await settle();

    expect(container.textContent).toContain("FIRST");
    // One fetch per distinct module, and no more.
    expect(fetches).toBe(afterFirst + 1);
  });
});
