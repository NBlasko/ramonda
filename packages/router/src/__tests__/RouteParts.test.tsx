import { describe, expect, test } from "vitest";
import { createRoutes, hiddenRoute, hides, matchCompiled } from "../match";

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

  /**
   * Found by review: a pattern was tried with each `:param` replaced by a sample value, so an earlier
   * route whose segment WAS that value claimed to hide it. `/:p/a` is reached by `/y/a`; `/x/a` hides
   * one of its addresses, not all of them.
   */
  /**
   * Review round 2: comparing segments as text missed a param written INSIDE a segment —
   * `:name.json` matches `a.json` at runtime, so the later route is never reached.
   */
  test("a param inside a segment hides what it matches, in any segment", () => {
    expect(() => createRoutes({ "/files/:name.json": view("any"), "/files/a.json": view("a") })).toThrow(
      /"\/files\/a\.json" can never be reached: "\/files\/:name\.json"/,
    );
    expect(() => createRoutes({ "/file-:id": view("any"), "/file-7": view("seven") })).toThrow(
      /"\/file-7" can never be reached: "\/file-:id"/,
    );
    expect(() => createRoutes({ "/files/:name.json": view("any"), "/files/a.txt": view("a") })).not.toThrow();
  });

  /** Review round 3: a whole-param segment matches every value a param inside a later segment can take. */
  test("a whole param hides a later segment with a param inside it", () => {
    expect(() => createRoutes({ "/:page": view("any"), "/file-:id": view("file") })).toThrow(
      /"\/file-:id" can never be reached: "\/:page"/,
    );
  });

  test("a fixed path hides only itself, whatever a sample would have said", () => {
    expect(() => createRoutes({ "/x/a": view("one"), "/:p/a": view("two") })).not.toThrow();
  });
});

/**
 * The refusal of a hidden route runs at module load, in production too, so it may not grow with the
 * square of the table. Found by review: every route was tried against every earlier one — 3000 routes
 * took 293 ms on every page load. A route can only be hidden by one with as many segments whose first
 * fixed segment is the same or a param, so only those are tried.
 *
 * Asked as the number of PAIRS compared, not as time. A limit in milliseconds failed on CI (120 ms for
 * what takes 7 ms locally), and so did a ratio of two timings (42 against 13–16 locally): both measured
 * the machine. The count is the same on every machine. Measured on these tables: the index compares
 * 0 pairs, every route against every earlier one 4,498,500, and grouping by segment count alone (the
 * review round 2 regression) 2,248,500.
 */
describe("a large table compares each route with a few others, not with all of them", () => {
  const pairsFor = (path: (i: number) => string) => {
    let pairs = 0;
    const routes = Array.from({ length: 3000 }, (_, i) => ({ key: path(i) }));
    const hidden = hiddenRoute(routes, (earlier, later) => {
      pairs++;
      return hides(earlier, later);
    });
    expect(hidden).toBeUndefined();
    return pairs;
  };

  test("3000 routes, half of them patterns", () => {
    expect(pairsFor((i) => (i % 2 ? `/section${i}/:id/detail` : `/page${i}`))).toBeLessThan(3000);
  });

  /** Every route behind a language param — the shape of an app in several languages. Review round 2. */
  test("3000 routes that all start with a param", () => {
    expect(pairsFor((i) => (i % 2 ? `/:lang/section${i}/:id` : `/:lang/page${i}`))).toBeLessThan(3000);
  });
});
