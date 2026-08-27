import { describe, expect, test } from "vitest";
import { Component } from "../../base/Component";
import { state, created, mounted } from "../../base/decorators";
import { renderStatic } from "../../hydration/ssr";
import { requestContext, requestKey, seedRequest } from "../../hydration/requestContext";

/**
 * The build guard: `renderStatic` renders a route with the request context poisoned, so a
 * route that reads per-request data reports `blockedBy` instead of markup — it cannot be baked.
 * A route that reads nothing per-request bakes to `{ html }`.
 */

const currentUser = requestKey<{ name: string } | null>("currentUser");
const url = new URL("https://example.com/");

describe("renderStatic — bakes what is request-independent", () => {
  test("a route that reads nothing per-request produces html", async () => {
    class Plain extends Component {
      render() {
        return (
          <main>
            <h1>Static</h1>
          </main>
        );
      }
    }
    const result = await renderStatic(<Plain />, url);
    expect(result.blockedBy).toBeUndefined();
    expect(result.html).toContain("<h1>Static</h1>");
  });

  test("reading the url is fine — it is the page identity, not per-request data", async () => {
    class ReadsUrl extends Component {
      @state path = "";
      @created init() {
        this.path = requestContext().url.pathname;
      }
      render() {
        return (
          <main>
            <h1>{this.path}</h1>
          </main>
        );
      }
    }
    const result = await renderStatic(<ReadsUrl />, new URL("https://example.com/docs"));
    expect(result.blockedBy).toBeUndefined();
    expect(result.html).toContain("/docs");
  });
});

describe("renderStatic — blocks a route that reads the request", () => {
  test("a synchronous read in render() blocks, naming the field", async () => {
    class ReadsCookieInRender extends Component {
      render() {
        const session = requestContext().cookies.get("session");
        return (
          <main>
            <h1>{session ?? "?"}</h1>
          </main>
        );
      }
    }
    const result = await renderStatic(<ReadsCookieInRender />, url);
    expect(result.html).toBeUndefined();
    expect(result.blockedBy).toBe('cookies.get("session")');
  });

  test("a read in @created blocks", async () => {
    class ReadsInCreate extends Component {
      @state name = "";
      @created init() {
        this.name = requestContext().get(currentUser)?.name ?? "";
      }
      render() {
        return (
          <main>
            <h1>{this.name}</h1>
          </main>
        );
      }
    }
    const result = await renderStatic(<ReadsInCreate />, url);
    expect(result.blockedBy).toBe('get("currentUser")');
  });

  test("a read in an ASYNC @mounted blocks too — recorded even when the throw is swallowed", async () => {
    class ReadsInAsyncMount extends Component {
      @state name = "";
      @mounted async load() {
        await Promise.resolve();
        // This throws into the drain's allSettled (swallowed), but the scope records the read.
        this.name = requestContext().get(currentUser)?.name ?? "";
      }
      render() {
        return (
          <main>
            <h1>{this.name || "…"}</h1>
          </main>
        );
      }
    }
    const result = await renderStatic(<ReadsInAsyncMount />, url);
    expect(result.blockedBy).toBe('get("currentUser")');
  });

  test("seedRequest during build does not un-block a read", async () => {
    class ReadsSeeded extends Component {
      render() {
        // Even if something seeded a value, READING it per-request is what blocks baking.
        seedRequest(currentUser, { name: "Ada" });
        const user = requestContext().get(currentUser);
        return (
          <main>
            <h1>{user?.name ?? "?"}</h1>
          </main>
        );
      }
    }
    const result = await renderStatic(<ReadsSeeded />, url);
    expect(result.blockedBy).toBe('get("currentUser")');
  });

  test("a genuine error is the caller's, not a blocked read", async () => {
    /**
     * `renderStatic` answers `blockedBy` for the one thing it is looking for — a per-request read
     * during a build — and passes everything else through. The distinction matters because the two
     * mean opposite things to a build: `blockedBy` says "bake this per request instead", while an
     * error says "this route is broken and the build should stop".
     *
     * The pass-through had no test, so nothing said which of the two a plain throw would become.
     */
    class Broken extends Component {
      render(): never {
        throw new Error("route is broken");
      }
    }

    await expect(renderStatic(<Broken />, new URL("https://example.com/broken"))).rejects.toThrow("route is broken");
  });
});
