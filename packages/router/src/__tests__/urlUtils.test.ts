import { describe, test, expect } from "vitest";
import { parseUrl, parseUrlString, buildUrl, sanitizeHref, normalizePathname } from "../urlUtils";

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

  test("normalizePathname strips a trailing slash but keeps root", () => {
    expect(normalizePathname("/")).toBe("/");
    expect(normalizePathname("/guide/state")).toBe("/guide/state");
    expect(normalizePathname("/guide/state/")).toBe("/guide/state");
    expect(normalizePathname("/guide/state//")).toBe("/guide/state");
    expect(normalizePathname("//")).toBe("/");
    // Only TRAILING slashes, and only from the end — the rest of the path is untouched.
    expect(normalizePathname("//a//b//")).toBe("//a//b");
    expect(normalizePathname("a/")).toBe("a");
    expect(normalizePathname("")).toBe("/");
  });

  test("normalizePathname is linear, so a crafted URL cannot freeze the tab", () => {
    /**
     * This used to be `pathname.replace(/\/+$/, "")`. That pattern cannot match a string which
     * does not END in a slash, so the engine retried from every position and backtracked the whole
     * run each time — quadratic. The input is `window.location.pathname`, so the string comes from
     * whatever URL someone was handed: a link was enough to hang the tab that opened it.
     *
     * Measured with the regex: 30k slashes 942ms, 60k 3.7s — and 200k below would be tens of
     * seconds. The scan does it in about a millisecond, so this bound is generous by two orders of
     * magnitude: loose enough never to flake, far too tight for the old shape to pass.
     */
    const crafted = `${"/".repeat(200_000)}a`;
    const started = performance.now();
    expect(normalizePathname(crafted)).toBe(crafted);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  test("parseUrlString normalizes a host-added trailing slash so the route still matches", () => {
    expect(parseUrlString("/concepts/state/").baseUrl).toBe("/concepts/state");
    expect(parseUrlString("/concepts/state/?a=1").baseUrl).toBe("/concepts/state");
  });

  test("parseUrl normalizes the current location's trailing slash", () => {
    window.history.pushState(null, "", "/concepts/state/");
    expect(parseUrl().baseUrl).toBe("/concepts/state");
  });
});
