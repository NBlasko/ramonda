import { describe, test, expect } from "vitest";
import { matchParams, matchRoute } from "../match";

describe("match", () => {
  test("matchParams extracts named params", () => {
    expect(matchParams("/players/123", "/players/:id")).toEqual({ id: "123" });
    expect(matchParams("/a/1/b/2", "/a/:x/b/:y")).toEqual({ x: "1", y: "2" });
  });

  test("matchParams returns null on mismatch", () => {
    expect(matchParams("/players", "/players/:id")).toBeNull();
    expect(matchParams("/players/1/extra", "/players/:id")).toBeNull();
  });

  test("matchRoute picks the first matching pattern, else '*'", () => {
    const keys = ["/", "/players/:id", "*"];
    expect(matchRoute("/players/9", keys)).toEqual({
      key: "/players/:id",
      params: { id: "9" },
    });
    expect(matchRoute("/", keys)).toEqual({ key: "/", params: {} });
    expect(matchRoute("/unknown/path", keys)).toEqual({
      key: "*",
      params: {},
    });
  });
});
