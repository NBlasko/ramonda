import { describe, expect, test } from "vitest";
import { urlsIn, withoutQuery } from "../compiler/urlsIn";

describe("the url() reader behind url-not-found", () => {
  test("finds each path, quoted or not, with where it starts", () => {
    const text = `url("./a.png") , url( './b.svg#x' ), URL(./c.woff2) url(data:x)`;

    expect(urlsIn(text).map((one) => [one.path, text.slice(one.at, one.at + one.path.length)])).toEqual([
      ["./a.png", "./a.png"],
      ["./b.svg#x", "./b.svg#x"],
      ["./c.woff2", "./c.woff2"],
      ["data:x", "data:x"],
    ]);
  });

  test("an unclosed url( is not a url", () => {
    expect(urlsIn(`url(./a.png`)).toEqual([]);
  });

  /** CodeQL on the PR: the regex this replaced did not return in two minutes on these. */
  test.each([
    ["url( and a run of spaces", `url(${" ".repeat(40000)}x`],
    ["many url( in a row", "url(".repeat(20000)],
  ])("%s is read in linear time", (_what, text) => {
    const started = performance.now();
    urlsIn(text);

    expect(performance.now() - started).toBeLessThan(500);
  });

  test("a query or fragment is cut at the first one, in linear time", () => {
    expect(withoutQuery("./icons.svg#home")).toBe("./icons.svg");
    expect(withoutQuery("./a.png?v=2#x")).toBe("./a.png");
    const started = performance.now();
    withoutQuery(`./${"#".repeat(40000)}`);

    expect(performance.now() - started).toBeLessThan(500);
  });
});
