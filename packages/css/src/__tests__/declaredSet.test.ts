import { describe, expect, test } from "vitest";
import { settingsAgainst, settingsIn } from "../compiler/declaredSet";
import { kind } from "../declared";

/**
 * The judgement a block, a stylesheet and a `style` attribute share — whether a declared variable
 * may be set to a value — and the reader that finds what a piece of CSS sets.
 */
const config = {
  variables: {
    $color: kind("color", {
      sunken: "#f3f4f6",
      moving: { value: "#ffffff", range: ["#ffffff", "#111827"] },
      free: { value: "#ffffff", range: "any" },
    }),
  },
};

describe("what a piece of CSS sets", () => {
  test("each custom property where a declaration starts, with where its name is", () => {
    const css = `[data-theme="dark"] {\n  --color-sunken: #000;\n  color: red; --b: 1px\n}\n`;

    expect(settingsIn(css)).toEqual([
      { name: "--color-sunken", value: "#000", at: css.indexOf("--color-sunken") },
      { name: "--b", value: "1px", at: css.indexOf("--b") },
    ]);
  });

  test("inside an at-rule, and a value with parens and a string holding `;`", () => {
    const css = `@media (x) { :root { --a: url("x;y"); --b: calc(1px + (2px)); } }`;

    expect(settingsIn(css).map((one) => [one.name, one.value])).toEqual([
      ["--a", `url("x;y")`],
      ["--b", "calc(1px + (2px))"],
    ]);
  });

  test("not inside a comment, a string, a value, or a selector", () => {
    const css = `.x { color: red; /* note; --a: red; */ content: "x; --b: red"; color: var(--c); } a--d { e: f }`;

    expect(settingsIn(css)).toEqual([]);
  });

  test("a `style` string is a list of declarations, and is read the same way", () => {
    expect(settingsIn("color: red; --color-sunken: blue").map((one) => one.name)).toEqual(["--color-sunken"]);
  });
});

describe("against the project's declarations", () => {
  const messages = (css: string) => settingsAgainst(css, config).map((one) => one.message);

  test("a fixed variable set at all is refused, naming it and `range`", () => {
    const [only, ...rest] = messages(`.x { --color-sunken: #f3f4f6; }`);

    expect(rest).toEqual([]);
    expect(only).toContain("`$color.sunken` is declared without a `range`");
  });

  test("a ranged one outside its range is refused, inside it is not", () => {
    expect(messages(`.x { --color-moving: red; }`)).toEqual([
      "`red` is not in the `range` of `$color.moving`, which may be #ffffff, #111827. Set one of those, or add it to the range in ramonda.css.ts.",
    ]);
    expect(messages(`.x { --color-moving: #111827 !important; }`)).toEqual([]);
    expect(messages(`.x { --color-moving: #FFFFFF; }`)).toEqual([]);
  });

  test("what cannot be read, `any`, and names nobody declared are left alone", () => {
    expect(messages(`.x { --color-moving: var(--y); --color-free: red; --brand: red; }`)).toEqual([]);
  });

  test("the position is the name's", () => {
    const css = `.x {\n  --color-sunken: red;\n}`;

    expect(settingsAgainst(css, config).map((one) => [one.at, one.length])).toEqual([
      [css.indexOf("--color-sunken"), "--color-sunken".length],
    ]);
  });
});
