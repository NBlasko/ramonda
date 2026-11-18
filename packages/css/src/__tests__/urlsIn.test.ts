import { describe, expect, test } from "vitest";
import { cpuTime } from "./cpuTime";
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
  test.each<[string, (round: number) => string]>([
    ["url( and a run of spaces", (round) => `url(${" ".repeat(40000 + round)}x`],
    ["many url( in a row", (round) => "url(".repeat(20000 + round)],
  ])("%s is read in linear time", (_what, text) => {
    expect(cpuTime(text, urlsIn)).toBeLessThan(500);
  });

  test("a query or fragment is cut at the first one, in linear time", () => {
    expect(withoutQuery("./icons.svg#home")).toBe("./icons.svg");
    expect(withoutQuery("./a.png?v=2#x")).toBe("./a.png");
    expect(cpuTime((round) => `./${"#".repeat(40000 + round)}`, withoutQuery)).toBeLessThan(500);
  });
});
