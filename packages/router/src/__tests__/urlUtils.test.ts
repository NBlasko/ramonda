import { describe, test, expect } from "vitest";
import {
  keepUnchanged,
  parseUrl,
  parseUrlString,
  buildUrl,
  sanitizeHref,
  normalizePathname,
  ownedBy,
  hashParamsFor,
} from "../urlUtils";

describe("urlUtils", () => {
  test("parseUrlString: pathname + query + hash → structured state", () => {
    const s = parseUrlString("/players/123?a=1&b=2#tab=film&play=5");
    expect(s.baseUrl).toBe("/players/123");
    expect(s.queryParams).toEqual({ a: "1", b: "2" });
    expect(hashParamsFor(s.hashScopes, "")).toEqual({ tab: "film", play: "5" });
  });

  /**
   * The hash is read the way the query is: `&` between pairs. It was split on `#` instead, one pair
   * per segment, and `#k1=v1&k2=v2` — the shape an OAuth redirect hands back — kept `k1` and dropped
   * `k2` without a word. Found by an agent building an app from the docs alone.
   */
  test("parseUrlString: every pair in the hash, as in the query", () => {
    expect(hashParamsFor(parseUrlString("/view#k1=v1&k2=v2").hashScopes, "")).toEqual({ k1: "v1", k2: "v2" });
    expect(hashParamsFor(parseUrlString("/view#access_token=abc&state=xyz").hashScopes, "")).toEqual({
      access_token: "abc",
      state: "xyz",
    });
  });

  test("parseUrlString: a bare hash names a section, and is a key with no value", () => {
    expect(hashParamsFor(parseUrlString("/x#open").hashScopes, "")).toEqual({ open: "" });
  });

  test("buildUrl: state → URL, the hash written as the query is", () => {
    const url = buildUrl({
      baseUrl: "/players/123",
      queryParams: { a: "1", b: "2" },
      hashScopes: { "": { tab: "film", play: "5" } },
    });
    expect(url).toBe("/players/123?a=1&b=2#tab=film&play=5");
  });

  test("buildUrl: a section stays a bare name, and a hash value is encoded", () => {
    expect(buildUrl({ baseUrl: "/x", queryParams: {}, hashScopes: { "": { install: "" } } })).toBe("/x#install");
    expect(buildUrl({ baseUrl: "/x", queryParams: {}, hashScopes: { "": { q: "a b&c" } } })).toBe("/x#q=a%20b%26c");
  });

  /**
   * One `#` segment per owner, the first always the top. The browser hands the fragment over as
   * written, and every key and value is percent-encoded, so a `#`, `:` or `.` in one stays a value.
   */
  test("the hash by owner: a segment per owner, and structure never mistaken for a value", () => {
    const s = parseUrlString("/v#nav=video#nav:tab=comments&sort=new");
    expect(s.hashScopes).toEqual({ "": { nav: "video" }, nav: { tab: "comments", sort: "new" } });
    expect(hashParamsFor(s.hashScopes, "nav")).toEqual({ nav: "video", tab: "comments", sort: "new" });
    expect(buildUrl(s)).toBe("/v#nav=video#nav:tab=comments&sort=new");

    const odd = buildUrl({ baseUrl: "/v", queryParams: {}, hashScopes: { "": { "a:b": "c#d" } } });
    expect(odd).toBe("/v#a%3Ab=c%23d");
    expect(parseUrlString(odd).hashScopes).toEqual({ "": { "a:b": "c#d" } });

    expect(ownedBy("", "a.b")).toBe("a%2Eb");
    expect(ownedBy("nav", "tab")).toBe("nav.tab");

    expect(parseUrlString("/v##nav:tab=comments").hashScopes).toEqual({ "": {}, nav: { tab: "comments" } });
    expect(buildUrl({ baseUrl: "/v", queryParams: {}, hashScopes: { "": { a: "1" }, nav: {} } })).toBe("/v#a=1");
  });

  test("round-trip: a hash with several pairs comes back whole", () => {
    expect(buildUrl(parseUrlString("/view#k1=v1&k2=v2"))).toBe("/view#k1=v1&k2=v2");
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
      hashScopes: {},
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

/**
 * A state restored from a page is plain JSON, and one from the previous router version has no
 * `hashScopes` at all. It is made well-formed ONCE, where it enters — `keepUnchanged`, which `init`
 * runs it through — rather than guarded at every place that reads it: a second review found three
 * that were and three that were not. After it, the owners have no prototype, so a `<HashLevel
 * of="constructor">` finds no owner rather than the `Object` function.
 */
describe("a restored state", () => {
  test("is made well-formed where it enters: owners with no prototype, old shape read as empty", () => {
    const fromJson = JSON.parse('{"baseUrl":"/","queryParams":{},"hashScopes":{"":{"a":"1"}}}');
    const kept = keepUnchanged(fromJson, parseUrlString("/#a=1"));
    expect(Object.getPrototypeOf(kept.hashScopes)).toBeNull();
    expect(kept.hashScopes["constructor"]).toBeUndefined();

    const old = JSON.parse('{"baseUrl":"/","queryParams":{},"hashTags":[]}');
    const replaced = keepUnchanged(old, parseUrlString("/#b=2"));
    expect(Object.getPrototypeOf(replaced.hashScopes)).toBeNull();
    expect(buildUrl(replaced)).toBe("/#b=2");
  });
});
