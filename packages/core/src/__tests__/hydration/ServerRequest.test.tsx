import { describe, expect, test } from "vitest";
import { Component } from "../../base/Component";
import { Host, state, created } from "../../base/decorators";
import { renderToString } from "../../hydration/ssr";
import { requestContext, requestKey } from "../../hydration/requestContext";

/**
 * A per-request server render (`renderToString(vnode, { request })`) makes `requestContext()`
 * return the real values, so a route can render per-user output on the server. Reads must be
 * synchronous (render / @created / before an @mounted's first await) — the scope is live only
 * across the synchronous section, for the same concurrency reason as `renderEnv`.
 */

const currentUser = requestKey<{ name: string } | null>("currentUser");

describe("renderToString with a request", () => {
  test("a component reads a seeded value in @created", async () => {
    @Host("main")
    class Greeting extends Component {
      @state name = "";
      @created init() {
        this.name = requestContext().get(currentUser)?.name ?? "guest";
      }
      render() {
        return <h1>Hello {this.name}</h1>;
      }
    }

    const html = await renderToString(<Greeting />, {
      request: { url: new URL("https://example.com/"), values: new Map([["currentUser", { name: "Ada" }]]) },
    });
    expect(html).toContain("Hello Ada");
  });

  test("a component reads a cookie synchronously in render()", async () => {
    @Host("main")
    class Session extends Component {
      render() {
        return <p>{requestContext().cookies.get("session") ?? "anon"}</p>;
      }
    }

    const html = await renderToString(<Session />, {
      request: { url: new URL("https://example.com/"), cookies: new Map([["session", "abc123"]]) },
    });
    expect(html).toContain("abc123");
  });

  test("a seeded value the request did not provide reads as its default", async () => {
    @Host("main")
    class Greeting extends Component {
      render() {
        return <h1>{requestContext().get(currentUser)?.name ?? "guest"}</h1>;
      }
    }

    const html = await renderToString(<Greeting />, { request: { url: new URL("https://example.com/") } });
    expect(html).toContain("guest");
  });
});

describe("without a request", () => {
  test("a plain render of a component that never reads the request still works", async () => {
    @Host("main")
    class Plain extends Component {
      render() {
        return <h1>Plain</h1>;
      }
    }
    const html = await renderToString(<Plain />);
    expect(html).toContain("Plain");
  });
});
