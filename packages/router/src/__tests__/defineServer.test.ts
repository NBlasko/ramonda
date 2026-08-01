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

    const plan = routePlan(server);
    expect(plan.static.sort()).toEqual(["/docs", "/u/:id"]);
    expect(plan.isr).toEqual([{ path: "/pricing", revalidate: 60 }]);
    expect(plan.server).toEqual(["/"]);
    expect(plan.needsData).toEqual(["/u/:id"]); // static + has :param
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

    const plan = routePlan(server);
    expect(plan.static.sort()).toEqual(["/", "/docs", "/u/:id"]);
    expect(plan.server).toEqual(["/pricing"]);
    expect(plan.isr).toEqual([]);
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
