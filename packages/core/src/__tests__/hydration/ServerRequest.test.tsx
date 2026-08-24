import { describe, expect, test } from "vitest";
import { Component } from "../../base/Component";
import { state, created } from "../../base/decorators";
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
    class Greeting extends Component {
      @state name = "";
      @created init() {
        this.name = requestContext().get(currentUser)?.name ?? "guest";
      }
      render() {
        return (
          <main>
            <h1>Hello {this.name}</h1>
          </main>
        );
      }
    }

    const html = await renderToString(<Greeting />, {
      request: { url: new URL("https://example.com/"), values: new Map([[currentUser, { name: "Ada" }] as const]) },
    });
    expect(html).toContain("Hello Ada");
  });

  test("a component reads a cookie synchronously in render()", async () => {
    class Session extends Component {
      render() {
        return (
          <main>
            <p>{requestContext().cookies.get("session") ?? "anon"}</p>
          </main>
        );
      }
    }

    const html = await renderToString(<Session />, {
      request: { url: new URL("https://example.com/"), cookies: new Map([["session", "abc123"]]) },
    });
    expect(html).toContain("abc123");
  });

  test("a seeded value the request did not provide reads as its default", async () => {
    class Greeting extends Component {
      render() {
        return (
          <main>
            <h1>{requestContext().get(currentUser)?.name ?? "guest"}</h1>
          </main>
        );
      }
    }

    const html = await renderToString(<Greeting />, { request: { url: new URL("https://example.com/") } });
    expect(html).toContain("guest");
  });
});

describe("without a request", () => {
  test("a plain render of a component that never reads the request still works", async () => {
    class Plain extends Component {
      render() {
        return (
          <main>
            <h1>Plain</h1>
          </main>
        );
      }
    }
    const html = await renderToString(<Plain />);
    expect(html).toContain("Plain");
  });

  /**
   * The shape a REAL server writes: several keys, of different types, seeded together.
   *
   * It is asserted because the obvious spelling does not work. `new Map([[user, …], [seats, 3]])`
   * infers `K` and `V` from the first entry and then refuses every other one — so `values` takes an
   * ITERABLE of pairs, which an array literal satisfies entry by entry. A `Map` still assigns when
   * it is annotated. Nothing else in the suite seeds more than one key, so nothing else would
   * notice this going back to a `Map`.
   */
  test("several keys of different types are seeded together", async () => {
    const seats = requestKey<number>("seats");
    const role = requestKey<string>("role");

    class Account extends Component {
      render() {
        const context = requestContext();
        return (
          <main>
            <p>
              {context.get(currentUser)?.name}/{String(context.get(role))}/{String(context.get(seats))}
            </p>
          </main>
        );
      }
    }

    const html = await renderToString(<Account />, {
      request: {
        url: new URL("https://example.com/"),
        values: [
          [currentUser, { name: "Ada" }],
          [role, "admin"],
          [seats, 3],
        ],
      },
    });
    expect(html).toContain("Ada/admin/3");
  });
});
