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

  test("a fixed path hides only itself, whatever a sample would have said", () => {
    expect(() => createRoutes({ "/x/a": view("one"), "/:p/a": view("two") })).not.toThrow();
  });
});

/**
 * The refusal of a hidden route runs at module load, in production too, so it may not grow with the
 * square of the table. Found by review: every route was tried against every earlier one — 3000 routes
 * took 293 ms on every page load. A route can only be hidden by one with as many segments whose first
 * segment is the same or a param, so only those are tried.
 */
describe("a large table is built in time that grows with its size", () => {
  test("3000 routes, half of them patterns", () => {
    const table: Record<string, ReturnType<typeof view>> = {};
    for (let i = 0; i < 3000; i++) table[i % 2 ? `/section${i}/:id/detail` : `/page${i}`] = view("x");
    expect(fastestOf(3, () => createRoutes(table))).toBeLessThan(100);
  });

  /** Every route behind a language param — the shape of an app in several languages. Review round 2. */
  test("3000 routes that all start with a param", () => {
    const table: Record<string, ReturnType<typeof view>> = {};
    for (let i = 0; i < 3000; i++) table[i % 2 ? `/:lang/section${i}/:id` : `/:lang/page${i}`] = view("x");
    expect(fastestOf(3, () => createRoutes(table))).toBeLessThan(100);
  });
});

/**
 * The fastest of a few runs. A single timing inside the full gate, beside every other package's
 * tests, read 108 ms for what takes 7 ms alone; the quadratic version this guards against took
 * 290 ms and 811 ms, so the fastest run still tells the two apart and a busy machine does not.
 */
function fastestOf(runs: number, work: () => void): number {
  let fastest = Number.POSITIVE_INFINITY;
  for (let at = 0; at < runs; at++) {
    const started = performance.now();
    work();
    fastest = Math.min(fastest, performance.now() - started);
  }
  return fastest;
}
