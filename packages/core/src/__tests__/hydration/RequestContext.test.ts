import { afterEach, describe, expect, test } from "vitest";
import {
  requestContext,
  requestKey,
  seedRequest,
  RequestReadDuringBuild,
  createRequestScope,
  setRequestScope,
  type RequestMode,
} from "../../hydration/requestContext";

/**
 * The request-context primitive and its poison guard — the core of prerender safety.
 * `renderToString` will set the scope around a render later; here the tests set it directly
 * so the three modes (server / build / client) can be exercised on their own.
 */

const currentUser = requestKey<{ name: string } | null>("currentUser");

function enter(mode: RequestMode, opts: { url?: string; cookies?: [string, string][] } = {}): void {
  setRequestScope(
    createRequestScope({
      mode,
      url: new URL(opts.url ?? "https://example.com/"),
      cookies: new Map(opts.cookies ?? []),
    }),
  );
}

afterEach(() => setRequestScope(undefined));

describe("server mode — real values", () => {
  test("reads url, cookies, headers, and a seeded key", () => {
    enter("server", { url: "https://example.com/u/42?x=1", cookies: [["session", "abc"]] });
    seedRequest(currentUser, { name: "Ada" });

    const ctx = requestContext();
    expect(ctx.url.pathname).toBe("/u/42");
    expect(ctx.cookies.get("session")).toBe("abc");
    expect(ctx.cookies.has("nope")).toBe(false);
    expect(ctx.get(currentUser)).toEqual({ name: "Ada" });
  });
});

describe("build mode — poisoned: per-request reads throw", () => {
  test("url is still safe (page identity)", () => {
    enter("build", { url: "https://example.com/docs" });
    expect(requestContext().url.pathname).toBe("/docs");
  });

  test("cookies.get throws, naming the field", () => {
    enter("build", { cookies: [["session", "abc"]] });
    let err: unknown;
    try {
      requestContext().cookies.get("session");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(RequestReadDuringBuild);
    expect((err as RequestReadDuringBuild).field).toBe('cookies.get("session")');
    expect(String((err as Error).message)).toContain("cannot be");
  });

  test("headers throws", () => {
    enter("build");
    expect(() => requestContext().headers).toThrow(RequestReadDuringBuild);
  });

  test("get(key) throws, naming the key", () => {
    enter("build");
    let err: unknown;
    try {
      requestContext().get(currentUser);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(RequestReadDuringBuild);
    expect((err as RequestReadDuringBuild).field).toBe('get("currentUser")');
  });
});

describe("client mode — exposed subset, no poison", () => {
  test("reads the values the server exposed; url comes from the browser, live", () => {
    enter("client", { url: "https://example.com/account" });
    seedRequest(currentUser, { name: "Ada" }); // stands in for the restored exposed blob
    const ctx = requestContext();
    expect(ctx.get(currentUser)).toEqual({ name: "Ada" });

    // In the browser the URL is read from `location` on every access rather than frozen at
    // hydration — otherwise a client-side navigation would leave `url` pointing at the page the
    // server happened to render. So the scope's seeded URL is deliberately NOT what comes back.
    expect(ctx.url.href).toBe(window.location.href);
  });

  test("a key the server did not expose reads as undefined", () => {
    enter("client");
    expect(requestContext().get(currentUser)).toBeUndefined();
  });
});

describe("outside a render", () => {
  test("requestContext reads throw a clear error", () => {
    setRequestScope(undefined);
    expect(() => requestContext().url).toThrow(/outside a render/);
  });
});
