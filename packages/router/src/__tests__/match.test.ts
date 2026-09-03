import { describe, test, expect } from "vitest";
import { matchParams } from "../match";

describe("match", () => {
  test("matchParams extracts named params", () => {
    expect(matchParams("/players/123", "/players/:id")).toEqual({ id: "123" });
    expect(matchParams("/a/1/b/2", "/a/:x/b/:y")).toEqual({ x: "1", y: "2" });
  });

  test("matchParams returns null on mismatch", () => {
    expect(matchParams("/players", "/players/:id")).toBeNull();
    expect(matchParams("/players/1/extra", "/players/:id")).toBeNull();
  });
});
