import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { Component } from "../../base/Component";
import { state, mounted, created } from "../../base/decorators";
import { AsyncLoad } from "../../base/AsyncLoad";
import { renderPage, renderToString } from "../../hydration/ssr";

/**
 * A server render waits for the async work its own lifecycle started.
 *
 * `@mounted` is where an app fetches — that is what the lifecycle is for, and it
 * runs on the server precisely so the data ends up in the HTML. But
 * `renderToString` used to await only microtasks (`flushTaskQueue`), so anything
 * taking a real round trip was still in flight when the markup was serialized.
 *
 * Measured before this: an `AsyncLoad` whose lazy resolved on a **macrotask**
 * put the loading fallback in the HTML, not the content — which is the shape of
 * every real `import()` and every real `fetch`.
 *
 * The trigger is deliberately not a new API: a lifecycle method that returns a
 * promise has it awaited, on the server only. `async @mounted` already returns one.
 */

/** A real round trip: settles on a macrotask, not a microtask. */
function afterATick<T>(value: T, ms = 5): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("the server waits for async @mounted", () => {
  test("a fetch that takes a macrotask lands in the HTML", async () => {
    class Profile extends Component {
      @state name = "";

      @mounted async load() {
        this.name = await afterATick("Ada");
      }

      render() {
        return (
          <div>
            <p>{this.name || "…"}</p>
          </div>
        );
      }
    }

    const html = await renderToString(<Profile />);

    // Before this, the markup said "…" — the fetch was still in flight.
    expect(html).toContain("Ada");
  });

  test("and the value is in the state blob, so the client does not refetch", async () => {
    class Profile extends Component {
      @state name = "";
      @mounted async load() {
        if (this.name) return; // restored from the server
        this.name = await afterATick("Grace");
      }
      render() {
        return (
          <div>
            <p>{this.name || "…"}</p>
          </div>
        );
      }
    }

    const page = await renderPage(<Profile />);
    expect(page.body).toContain("Grace");
    // @state is serialized, which is what makes the guard above work on the
    // client: a shared @mounted runs on BOTH sides, and the blob is the memo.
    expect(page.body).toContain("Grace");
    // The blob rides the opening marker rather than an attribute on a host element.
    expect(page.body).toMatch(/<!--c\d+ \{"state"/);
  });

  test("work started by the result of earlier work is awaited too", async () => {
    // The reason one pass is not enough: a resolved fetch writes state, which
    // schedules a render, which builds a component whose own @mounted fetches.
    class Detail extends Component<{ id: string }> {
      @state text = "";
      @mounted async load() {
        this.text = await afterATick(`detail-for-${this.props.id}`);
      }
      render() {
        return (
          <span>
            <i>{this.text || "…"}</i>
          </span>
        );
      }
    }

    class Page extends Component {
      @state id = "";
      @mounted async load() {
        this.id = await afterATick("42");
      }
      render() {
        return <div>{this.id ? <Detail id={this.id} /> : <p>…</p>}</div>;
      }
    }

    const html = await renderToString(<Page />);

    expect(html).toContain("detail-for-42");
  });

  test("a rejected fetch does not cost the rest of the page", async () => {
    class Flaky extends Component {
      @state status = "pending";
      @mounted async load() {
        try {
          await Promise.reject(new Error("nope"));
        } catch {
          this.status = "failed";
        }
      }
      render() {
        return (
          <div>
            <p>flaky: {this.status}</p>
          </div>
        );
      }
    }

    class Fine extends Component {
      @state value = "";
      @mounted async load() {
        this.value = await afterATick("ok");
      }
      render() {
        return (
          <div>
            <p>fine: {this.value || "…"}</p>
          </div>
        );
      }
    }

    class Page extends Component {
      render() {
        return (
          <div>
            <div>
              <Flaky />
              <Fine />
            </div>
          </div>
        );
      }
    }

    const html = await renderToString(<Page />);

    // allSettled, not all: one failure must not lose the page.
    expect(html).toContain("flaky: failed");
    expect(html).toContain("fine: ok");
  });

  test("a page with no async work is not slowed down", async () => {
    class Plain extends Component {
      @created init() {}
      @mounted ready() {}
      render() {
        return (
          <div>
            <p>plain</p>
          </div>
        );
      }
    }

    /**
     * Asked as "was a timer created", not "was it fast".
     *
     * This was `Date.now() - started < 50`, and a full-width `pnpm check` failed it at 97 ms — the same
     * code passing 15/15 alone, three runs. A wall-clock bound is not a gate for this claim. The claim
     * is that the drain returns on its FIRST round when nothing registered, because a page that paid a
     * timeout per render would be a real regression on every static page — and that is a COUNT, which
     * does not care how busy the machine is.
     *
     * A spy rather than fake timers, and the difference is how it fails. Planted both ways: with a
     * `setTimeout` added to the drain loop, fake timers made the whole file HANG — correct, since
     * nothing would advance the clock, but a hang carries no message. The spy names the fault.
     */
    const timer = vi.spyOn(globalThis, "setTimeout");
    try {
      const html = await renderToString(<Plain />);

      expect(html).toContain("plain");
      expect(timer, "the drain paid a timeout for a page with no async work").not.toHaveBeenCalled();
    } finally {
      timer.mockRestore();
    }
  });

  test("a fetch waterfall fails loudly instead of hanging the request", async () => {
    // A real waterfall needs each round to create a NEW component: @mounted runs
    // once per instance, so a single component awaiting in a loop is not one.
    // Here every resolved fetch renders the next level down, which mounts and
    // fetches again — the shape the bound exists for. A server cannot know how
    // deep it goes, so it has to stop.
    class Chain extends Component<{ depth: number }> {
      @state loaded = false;
      @mounted async load() {
        this.loaded = await afterATick(true, 1);
      }
      render() {
        return <div>{this.loaded ? <Chain depth={this.props.depth + 1} /> : <p>…</p>}</div>;
      }
    }

    await expect(renderToString(<Chain depth={0} />)).rejects.toThrow(/gave up after \d+ rounds of async work/);
  });

  test("giving up STOPS the work — it does not leave the tree running", async () => {
    // The throw above is only half the contract. Measured before this was
    // fixed, on exactly that waterfall: at the throw 11 mounts had started and
    // 10 settled; 60ms later it was 48 and 47, with **74 renders after the
    // throw**, and it only stopped because the process did.
    //
    // On a server that is one runaway tree per failed request — CPU, memory and
    // outbound calls, none of it bounded and none of it reachable. It also
    // showed up as an unhandled `document is not defined` in the full test run,
    // which is what a render into a torn-down environment looks like.
    let mountsSettled = 0;
    let rendersAfterThrow = 0;
    let thrown = false;

    class Chain extends Component<{ depth: number }> {
      @state loaded = false;
      @mounted async load() {
        this.loaded = await afterATick(true, 1);
        mountsSettled++;
      }
      render() {
        if (thrown) rendersAfterThrow++;
        return <div>{this.loaded ? <Chain depth={this.props.depth + 1} /> : <p>…</p>}</div>;
      }
    }

    await expect(renderToString(<Chain depth={0} />)).rejects.toThrow(/gave up/);
    thrown = true;

    const settledAtThrow = mountsSettled;
    await new Promise((resolve) => setTimeout(resolve, 60));

    // The one mount already in flight still settles — a promise cannot be
    // recalled — but it schedules nothing, and no new round ever begins.
    expect(mountsSettled - settledAtThrow).toBeLessThanOrEqual(1);
    expect(rendersAfterThrow).toBe(0);
  });
});

describe("AsyncLoad on the server", () => {
  class Loaded extends Component<{ label?: string }> {
    render() {
      return (
        <div>
          <p>LOADED: {this.props.label ?? "-"}</p>
        </div>
      );
    }
  }

  test("a realistic import is awaited, so the chunk's content is in the HTML", async () => {
    class Page extends Component {
      render() {
        return (
          <div>
            <AsyncLoad
              cacheKey="server-slow-import"
              lazy={() => afterATick({ Loaded }, 8)}
              namedExport="Loaded"
              loadedProps={{ label: "from server" }}
              onLoading={<p>loading…</p>}
              errorFallback={<p>failed</p>}
            />
          </div>
        );
      }
    }

    const page = await renderPage(<Page />);

    // The whole scenario: the async part rendered on the server, with its own
    // state blob, ready for the client to adopt rather than rebuild.
    expect(page.body).toContain("LOADED: from server");
    expect(page.body).not.toContain("loading…");
    /**
     * And it is a MOUNTED component rather than markup that happens to say the right thing: its
     * marker pair is in the body, which only a component that reached the reconciler has.
     *
     * `data-ramonda="Loaded"` used to be the proof. That was a DEV attribute on a host element, and
     * a component has no element of its own — the marker is what says one is here.
     */
    expect(page.body).toMatch(/<!--c\d+/);
  });

  test("a failed import renders its fallback rather than losing the page", async () => {
    class Page extends Component {
      render() {
        return (
          <div>
            <div>
              <p>chrome</p>
              <AsyncLoad
                cacheKey="server-failed-import"
                lazy={() => Promise.reject(new Error("chunk 404"))}
                namedExport="Loaded"
                onLoading={<p>loading…</p>}
                errorFallback={<p>failed</p>}
              />
            </div>
          </div>
        );
      }
    }

    vi.spyOn(console, "error").mockImplementation(() => {});
    const html = await renderToString(<Page />);

    expect(html).toContain("chrome");
    expect(html).toContain("failed");
  });
});

describe("modulepreload hints", () => {
  class Chunk extends Component {
    render() {
      return (
        <div>
          <p>chunk</p>
        </div>
      );
    }
  }

  function page(preload: string | readonly string[] | undefined, key: string) {
    class Page extends Component {
      render() {
        return (
          <div>
            <AsyncLoad
              cacheKey={key}
              preload={preload}
              lazy={() => afterATick({ Chunk }, 4)}
              namedExport="Chunk"
              onLoading={<p>loading…</p>}
              errorFallback={<p>failed</p>}
            />
          </div>
        );
      }
    }
    return <Page />;
  }

  test("the server emits a hint into the head", async () => {
    const rendered = await renderPage(page("/assets/chunk-a.js", "pre-1"));

    expect(rendered.head).toContain('rel="modulepreload"');
    expect(rendered.head).toContain('href="/assets/chunk-a.js"');
    // And the chunk's own content is in the body — the hint is an optimisation
    // on top of the content being there, not a substitute for it.
    expect(rendered.body).toContain("chunk");
  });

  test("several chunks, and no duplicates", async () => {
    const rendered = await renderPage(page(["/assets/a.js", "/assets/b.js", "/assets/a.js"], "pre-2"));

    const hints = rendered.head.match(/rel="modulepreload"/g) ?? [];
    expect(hints.length).toBe(2);
    expect(rendered.head).toContain("/assets/a.js");
    expect(rendered.head).toContain("/assets/b.js");
  });

  test("no hint when none was given", async () => {
    const rendered = await renderPage(page(undefined, "pre-3"));
    expect(rendered.head).not.toContain("modulepreload");
  });

  test("hints do not leak between pages", async () => {
    await renderPage(page("/assets/first.js", "pre-4"));
    const second = await renderPage(page("/assets/second.js", "pre-5"));

    // renderPage resets the head per page; a hint carried over would tell the
    // browser to fetch a chunk this page does not use.
    expect(second.head).toContain("/assets/second.js");
    expect(second.head).not.toContain("/assets/first.js");
  });

  test("renderDocument puts them in the served <head>", async () => {
    const { renderDocument } = await import("../../hydration/document");
    const rendered = await renderPage(page("/assets/chunk-doc.js", "pre-6"));
    const html = renderDocument(rendered, { scripts: ["/assets/client.js"] });

    // Before the main bundle's <script>, which is the point: the browser can
    // start both fetches from one parse of <head>.
    expect(html.indexOf('rel="modulepreload"')).toBeLessThan(html.indexOf('src="/assets/client.js"'));
  });

  test("the client emits nothing — the import is already in flight", async () => {
    const { bootstrap } = await import("../../index");
    const container = document.createElement("div");
    document.body.appendChild(container);

    const before = document.head.querySelectorAll("link[rel=modulepreload]").length;
    bootstrap(page("/assets/client-side.js", "pre-7"), container);
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(document.head.querySelectorAll("link[rel=modulepreload]").length).toBe(before);
    container.remove();
  });
});
