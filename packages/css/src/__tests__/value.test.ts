import { describe, expect, test } from "vitest";
import type { CssVar } from "../token";
import { toStyle } from "../value";

/**
 * SETTING a value on an element, which is the one place a value the render decided still reaches
 * CSS.
 *
 * This file used to be about `block()` and `toStyleObject` — a descriptor a call filled with a
 * hole's values, and the `{ className, style }` a renderer with no `css` prop of its own spread. A
 * runtime value in a declaration is refused and a block IS its class string, so a renderer writes
 * `className={panel}` and there is nothing left to adapt.
 *
 * **What did not go away is the rule those two carried**, and it moved here with the hazard: a value
 * ends up in a `style` attribute, a server-rendered page is parsed back from HTML, and a value
 * holding a `;` becomes a SECOND declaration on the element. Measured through `renderToString` and
 * back through `innerHTML`: `red; position: fixed; width: 100vw` came out as real, applied
 * declarations.
 */
const angle = "--angle" as CssVar<"angle">;
const tone = "--tone" as CssVar<"color">;

describe("a value set on an element", () => {
  test("is written under the name it was declared with", () => {
    expect(toStyle([[angle, "45deg"]])).toEqual({ "--angle": "45deg" });
  });

  test("and several at once, which is one call per element", () => {
    expect(
      toStyle([
        [angle, "45deg"],
        [tone, "#10b981"],
      ]),
    ).toEqual({ "--angle": "45deg", "--tone": "#10b981" });
  });

  test("a number is written as itself, because plenty of properties take one", () => {
    expect(toStyle([[angle, 0]])).toEqual({ "--angle": "0" });
  });
});

describe("a value that may not be written", () => {
  /**
   * **The property is left UNSET rather than written as something else.** An unset custom property
   * makes the declaration reading it invalid at computed-value time, which drops that declaration
   * and leaves whatever the stylesheet said. A missing border beats a full-viewport overlay
   * somebody's record asked for.
   */
  /**
   * **Cast past the TYPE, which refuses it first.** `red; position: fixed` is not a colour, so a
   * value written out is reported where it is written. This is the belt for what a type cannot
   * hold: a cast, an `any`, a JavaScript caller, data off an API.
   */
  test("a `;` is refused, so it cannot become a second declaration", () => {
    expect(toStyle([[tone, "red; position: fixed; width: 100vw" as never]])).toEqual({});
  });

  /**
   * **And the same belt on the NAME, which had none.**
   *
   * The value's guard exists because a `style` attribute is parsed back out of HTML on a
   * server-rendered page. The NAME is written into that same attribute and was returned verbatim
   * whenever it began with `--`, so the identical hazard came through the other door. Measured end
   * to end — server render, then the browser's own parser on those bytes:
   *
   *     `;` in the value    declarations=[]
   *     `;` in the NAME     declarations=[--brand=red, --evil=red]
   *
   * Two applied declarations from one setting. Reachable only past the types, which is the threat
   * model this whole describe is written for.
   *
   * It THROWS rather than skipping, unlike a value: `nameOf` already throws for a token that is not
   * this package's, and a malformed name is the same thing — not data that turned out wrong, but a
   * name nothing here ever wrote.
   */
  test.each([
    ["a `;`", "--brand: red; --evil"],
    ["a space", "--brand red"],
    ["a `:`", "--brand:x"],
    ['a `"`', '--brand" onload="alert(1)'],
    ["a `}`", "--brand}"],
    ["nothing after the dashes", "--"],
  ])("a name carrying %s is refused", (_what, token) => {
    expect(() => toStyle([[token as never, "red" as never]])).toThrow(/not a variable this package wrote/);
  });

  /** The control: the names this package really writes are accepted, measured from a real build. */
  test.each([["--color-accent-main"], ["--r-6lbmZbNkr"], ["--space-gutter-normal"], ["--x_1"]])(
    "%s is a name this package writes, and is kept",
    (token) => {
      expect(toStyle([[token as never, "red" as never]])).toEqual({ [token]: "red" });
    },
  );

  test("and only that value — the others beside it are written", () => {
    expect(
      toStyle([
        [angle, "45deg"],
        [tone, "red; position: fixed" as never],
      ]),
    ).toEqual({ "--angle": "45deg" });
  });

  test.each([
    ["NaN", Number.NaN],
    ["an infinity", Number.POSITIVE_INFINITY],
  ])("%s is refused, because no property can parse it", (_what, value) => {
    expect(toStyle([[angle, value as never]])).toEqual({});
  });

  /**
   * Nothing else can arrive through the types, so what reaches here came from JavaScript nobody
   * checked — a cast, an `any`, data off an API.
   */
  test.each([
    ["an object", {}],
    ["null", null],
    ["undefined", undefined],
  ])("%s is refused, which the types already do", (_what, value) => {
    expect(toStyle([[angle, value as never]])).toEqual({});
  });

  /** `0` and `""` are VALUES and must not become this case. */
  test("the empty string is written, because the caller wrote it", () => {
    expect(toStyle([[tone, "" as never]])).toEqual({ "--tone": "" });
  });
});
