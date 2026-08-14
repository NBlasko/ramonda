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

  test("a dot in a directory name is not an extension", () => {
    // Read from the last SEGMENT, not the whole path: `/v1.2/bundle` has no extension, and a
    // whole-path search would answer for `.2/bundle`.
    expect(mimeFor("/assets/v1.2/bundle")).toBe("application/octet-stream");
    expect(mimeFor("/assets/v1.2/bundle.js")).toBe("text/javascript");
  });

  test("a dotfile has no extension, it has a name", () => {
    expect(mimeFor("/.gitignore")).toBe("application/octet-stream");
  });

  test("the extension is matched whatever its case", () => {
    expect(mimeFor("/LOGO.SVG")).toBe("image/svg+xml");
  });

  test("a query string is not part of the name", () => {
    // A static handler is normally handed a filesystem path, but a URL reaches one often enough
    // that answering `application/octet-stream` for `client.js?v=2` would be a live fault.
    expect(mimeFor("/assets/client.js?v=2")).toBe("text/javascript");
  });
});
