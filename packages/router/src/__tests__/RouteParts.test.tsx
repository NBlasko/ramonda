import { describe, expect, test } from "vitest";
import { createRoutes, matchCompiled } from "../match";

/**
 * A table assembled from PARTS — a module's table, another's, the app's own — as
 * `DESIGN-module-routes.md` decides: `createRoutes(tournamentRoutes, authRoutes, { "/": <Home /> })`.
 *
 * A spread was the obvious spelling and it cannot work: `createRoutes` returns a COMPILED table, so
 * `{ ...tournamentRoutes }` copied `compiled` and `fallback` as if they were paths.
 */
const view = (name: string) => <p>{name}</p>;
const keyAt = (path: string, table: Parameters<typeof matchCompiled>[1]) => matchCompiled(path, table).key;

describe("createRoutes takes parts", () => {
  test("a compiled part, a literal part and an empty one, matched in the order they are given", () => {
    const tournaments = createRoutes({ "/tournaments": view("list"), "/tournaments/:id": view("one") });
    const debug = undefined;
    const routes = createRoutes(tournaments, debug, { "/": view("home"), "*": view("missing") });

    expect(keyAt("/tournaments", routes)).toBe("/tournaments");
    expect(matchCompiled("/tournaments/7", routes)).toMatchObject({ key: "/tournaments/:id", params: { id: "7" } });
    expect(keyAt("/", routes)).toBe("/");
    expect(keyAt("/nope", routes)).toBe("*");
    expect(routes.compiled.map((one) => one.key)).toEqual(["/tournaments", "/tournaments/:id", "/"]);
  });

  test("one literal table is the one-part case, unchanged", () => {
    const routes = createRoutes({ "/": view("home"), "/about": view("about") });
    expect(routes.compiled.map((one) => one.key)).toEqual(["/", "/about"]);
  });
});

/**
 * What is never meant, refused when the table is built — at module load, so the first dev server
 * start or test run fails on it and it never ships.
 */
describe("createRoutes refuses what can never be meant", () => {
  test("a path two parts both name", () => {
    const tournaments = createRoutes({ "/tournaments": view("list") });
    expect(() => createRoutes(tournaments, { "/tournaments": view("again") })).toThrow(
      /"\/tournaments" is in two parts of this table — part 1 and part 2/,
    );
  });

  test("a second catch-all", () => {
    expect(() => createRoutes({ "*": view("one") }, { "*": view("two") })).toThrow(/a second "\*"/);
  });

  test("a route an earlier pattern hides, across parts and within one", () => {
    const tournaments = createRoutes({ "/tournaments/:id": view("one") });
    expect(() => createRoutes(tournaments, { "/tournaments/new": view("new") })).toThrow(
      /"\/tournaments\/new" can never be reached: "\/tournaments\/:id", before it, matches it first/,
    );
    expect(() => createRoutes({ "/u/:id": view("one"), "/u/:name": view("two") })).toThrow(
      /"\/u\/:name" can never be reached: "\/u\/:id", before it, matches it first/,
    );
  });

  test("the same two the other way round are fine — the static path is matched first", () => {
    expect(() => createRoutes({ "/tournaments/new": view("new") }, { "/tournaments/:id": view("one") })).not.toThrow();
    expect(() => createRoutes({ "/u/:id": view("one"), "/u/:id/edit": view("edit") })).not.toThrow();
  });
});
