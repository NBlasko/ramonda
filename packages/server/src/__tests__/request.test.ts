import { describe, expect, test } from "vitest";
import { mimeFor, parseCookies } from "../request";

describe("parseCookies", () => {
  test("reads a header into the Map a request context wants", () => {
    const jar = parseCookies("theme=dark; session=abc123");
    expect(jar.get("theme")).toBe("dark");
    expect(jar.get("session")).toBe("abc123");
  });

  test("no header is an empty jar, not a throw", () => {
    expect(parseCookies(undefined).size).toBe(0);
    expect(parseCookies("").size).toBe(0);
  });

  test("decodes the value, because that is how it was written", () => {
    expect(parseCookies("q=a%20b%3Dc").get("q")).toBe("a b=c");
  });

  test("a value containing `=` keeps all of it", () => {
    // Base64 pads with `=`, so splitting on every `=` truncates exactly the cookies that matter.
    expect(parseCookies("token=YWJjZA==").get("token")).toBe("YWJjZA==");
  });

  test("a malformed pair is skipped rather than poisoning the jar", () => {
    const jar = parseCookies("broken; theme=dark");
    expect(jar.has("broken")).toBe(false);
    expect(jar.get("theme")).toBe("dark");
  });

  test("a value that is not valid percent-encoding is kept raw", () => {
    // `decodeURIComponent("%")` throws. A visitor with one bad cookie must not take the request
    // down with them.
    expect(parseCookies("a=100%; theme=dark").get("a")).toBe("100%");
    expect(parseCookies("a=100%; theme=dark").get("theme")).toBe("dark");
  });
});

describe("mimeFor", () => {
  test("names the types a built client actually emits", () => {
    expect(mimeFor("/assets/client.js")).toBe("text/javascript");
    expect(mimeFor("/assets/app.css")).toBe("text/css");
    expect(mimeFor("/logo.svg")).toBe("image/svg+xml");
  });

  test("an unknown extension is a byte stream, not a guess", () => {
    expect(mimeFor("/download.bin")).toBe("application/octet-stream");
  });
});
