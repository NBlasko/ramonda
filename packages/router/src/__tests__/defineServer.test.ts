import { describe, expect, test } from "vitest";
import type { VNode } from "@ramonda/core";
import { createRoutes } from "../match";
import { defineServer, routePlan } from "../server";

/**
 * Layer B: `defineServer` attaches rendering modes to the shared route table (exhaustively,
 * so the two can't drift), and `routePlan` partitions them for the build. The `@ts-expect-error`
 * lines are validated by check-types — a missing/extra route key must not compile.
 */

const stub = null as unknown as VNode;

const routes = createRoutes({
  "/": stub,
  "/docs": stub,
  "/pricing": stub,
  "/u/:id": stub,
  "*": stub,
});

describe("routePlan partitions by declared mode", () => {
  test("prerender / revalidate / default-server, with :param → needsData", () => {
    const server = defineServer(routes, {
      "/": {},
      "/docs": { prerender: true },
      "/pricing": { revalidate: 60 },
      "/u/:id": { prerender: true },
    });

    const plan = routePlan(server, ["/u/7", "/u/9"]);
    // `/u/:id` is NOT here, and the two pages it stands for ARE. This assertion used to read
    // `["/docs", "/u/:id"]`, which is the bug it pinned: a build loop bakes what it is given, so the
    // pattern became a directory literally named `:id`.
    expect(plan.static.sort()).toEqual(["/docs", "/u/7", "/u/9"]);
    expect(plan.isr).toEqual([{ path: "/pricing", revalidate: 60 }]);
    expect(plan.server).toEqual(["/"]);
    expect(plan.needsData).toEqual(["/u/:id"]); // still named: this is the route the paths were for
  });

  test('defaultMode "static" bakes unmarked routes; prerender:false opts out', () => {
    const server = defineServer(
      routes,
      {
        "/": {},
        "/docs": {},
        "/pricing": { prerender: false },
        "/u/:id": {},
      },
      { defaultMode: "static" },
    );

    const plan = routePlan(server, ["/u/7"]);
    expect(plan.static.sort()).toEqual(["/", "/docs", "/u/7"]);
    expect(plan.server).toEqual(["/pricing"]);
    expect(plan.isr).toEqual([]);
  });

  /**
   * A parameterised route marked for prerender with nothing supplied STOPS the build.
   *
   * Not skipped and not fallen back to the server: a config that says `prerender` and a build that
   * quietly does not is how a site ships missing half its pages while every page it emitted looks
   * perfectly correct. `renderStatic`'s `blockedBy` already settles that argument by stopping.
   */
  test("a :param route marked for prerender with no paths throws, naming the route", () => {
    const server = defineServer(routes, {
      "/": {},
      "/docs": {},
      "/pricing": {},
      "/u/:id": { prerender: true },
    });

    expect(() => routePlan(server)).toThrow(/`\/u\/:id` is marked for prerender and takes :id/);
    // And the message says what to pass, spelled with the route's own param name.
    expect(() => routePlan(server)).toThrow(/routePlan\(server, items\.map\(\(item\) => `\/u\/\$\{item\.id\}`\)\)/);
  });

  test("a path that satisfies no pattern does not count as data for it", () => {
    const server = defineServer(routes, {
      "/": {},
      "/docs": {},
      "/pricing": {},
      "/u/:id": { prerender: true },
    });

    expect(() => routePlan(server, ["/docs", "/u"])).toThrow(/marked for prerender/);
  });

  /**
   * ISR is not held to it. A `revalidate` route with params is served and refreshed per request, so
   * its pattern is a RULE rather than a page and there is nothing for a build to bake — it stays
   * named in `needsData` so a build that wants to warm those pages can be told which exist.
   */
  test("an ISR route with a :param is named but never demanded", () => {
    const server = defineServer(routes, {
      "/": {},
      "/docs": {},
      "/pricing": {},
      "/u/:id": { revalidate: 30 },
    });

    const plan = routePlan(server);
    expect(plan.isr).toEqual([{ path: "/u/:id", revalidate: 30 }]);
    expect(plan.needsData).toEqual(["/u/:id"]);
    expect(plan.static).toEqual([]);
  });

  /**
   * One path can satisfy two patterns — the file it bakes is the same file either way — so the list
   * is deduped rather than the match narrowed.
   *
   * The overlap has to be real, and the first version of this test did not have one: `/u/7` has two
   * segments and `/:page` matches one, so that pattern got nothing and the throw above fired. Two
   * patterns of the SAME shape is the case, which is also the only way an app can write it by accident.
   */
  test("a path matching two patterns is baked once", () => {
    const twoPatterns = createRoutes({ "/u/:id": stub, "/:kind/:key": stub, "*": stub });
    const server = defineServer(twoPatterns, { "/u/:id": { prerender: true }, "/:kind/:key": { prerender: true } });

    const plan = routePlan(server, ["/u/7"]);
    expect(plan.static).toEqual(["/u/7"]);
    expect(plan.needsData.sort()).toEqual(["/:kind/:key", "/u/:id"]);
  });
});

describe("the config is exhaustive — the table and the server config can't drift", () => {
  test("every route present type-checks and runs", () => {
    const server = defineServer(routes, {
      "/": {},
      "/docs": {},
      "/pricing": {},
      "/u/:id": {},
    });
    expect(server.defaultMode).toBe("server");
  });

  test("type errors for a missing or unknown route", () => {
    // @ts-expect-error — "/docs", "/pricing", "/u/:id" are missing
    defineServer(routes, { "/": {} });

    defineServer(routes, {
      "/": {},
      "/docs": {},
      "/pricing": {},
      "/u/:id": {},
      // @ts-expect-error — "/nope" is not a route in the table
      "/nope": {},
    });
  });
});

describe("the browser stub forbids server config on the client", () => {
  test("importing @ramonda/router/server's browser build throws", async () => {
    await expect(import("../server.browser")).rejects.toThrow(/client bundle/);
  });
});
