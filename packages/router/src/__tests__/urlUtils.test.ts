import { describe, test, expect } from "vitest";
import { parseUrl, parseUrlString, buildUrl, sanitizeHref } from "../urlUtils";

describe("urlUtils", () => {
  test("parseUrlString: pathname + query + hash → structured state", () => {
    const s = parseUrlString("/players/123?a=1&b=2#tab=film#play=5");
    expect(s.baseUrl).toBe("/players/123");
    expect(s.queryParams).toEqual({ a: "1", b: "2" });
    expect(s.hashTags).toEqual([
      { key: "tab", value: "film", level: 0 },
      { key: "play", value: "5", level: 1 },
    ]);
  });

  test("parseUrlString: bare hash segment (no value)", () => {
    const s = parseUrlString("/x#open");
    expect(s.hashTags).toEqual([{ key: "open", value: "", level: 0 }]);
  });

  test("buildUrl: state → URL, hash sorted by level", () => {
    const url = buildUrl({
      baseUrl: "/players/123",
      queryParams: { a: "1", b: "2" },
      hashTags: [
        { key: "play", value: "5", level: 1 },
        { key: "tab", value: "film", level: 0 },
      ],
    });
    expect(url).toBe("/players/123?a=1&b=2#tab=film#play=5");
  });

  test("round-trip parseUrlString ∘ buildUrl is stable", () => {
    const url = "/a/b?x=1&y=hello#t=1";
    const again = buildUrl(parseUrlString(url));
    expect(again).toBe(url);
  });

  test("buildUrl encodes query values", () => {
    const url = buildUrl({
      baseUrl: "/s",
      queryParams: { q: "a b&c" },
      hashTags: [],
    });
    expect(url).toBe("/s?q=a%20b%26c");
  });

  test("sanitizeHref blocks dangerous protocols, allows relative + http(s)", () => {
    expect(sanitizeHref("/players/1")).toBe("/players/1");
    expect(sanitizeHref("https://ok.com")).toBe("https://ok.com");
    expect(sanitizeHref("javascript:alert(1)")).toBe("/");
    expect(sanitizeHref("data:text/html,x")).toBe("/");
    expect(sanitizeHref("//evil.com")).toBe("/"); // protocol-relative rejected
  });

  test("parseUrl reads the current jsdom location", () => {
    window.history.pushState(null, "", "/now?z=9");
    const s = parseUrl();
    expect(s.baseUrl).toBe("/now");
    expect(s.queryParams).toEqual({ z: "9" });
  });
});
