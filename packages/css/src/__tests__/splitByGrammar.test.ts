import { describe, expect, test } from "vitest";
import { splitByGrammar } from "../compiler/split";
import type { GrammarShape } from "../compiler/grammarShapes.generated";
import { parseValueSyntax } from "../compiler/valueSyntax";

/**
 * Splitting by reading the value AGAINST the family's grammar, rather than by filling slots.
 *
 * The slots hand each token to the first one that takes it; a parse hands it to whichever part the
 * grammar reaches first, and backtracks when that leaves the rest unreadable. The shapes here are
 * written out rather than read from the generated table, so each test says what it is about — the
 * table's own correctness is the generator's gate, not this file's.
 */

/** A shape, from a grammar and a leaf description per leaf in the order the grammar names them. */
const shape = (
  grammar: string,
  longhands: readonly string[],
  leaves: readonly Partial<GrammarShape["leaves"][number]>[],
  list = false,
): GrammarShape => ({
  longhands,
  tree: parseValueSyntax(grammar),
  leaves: leaves.map((one) => ({ longhands: [], words: [], types: [], functions: [], open: false, ...one })),
  ...(list ? { list: true } : {}),
});

/** `border`-shaped: three parts in any order, each with its own longhand. */
const BORDER = shape(
  "<line-width> || <line-style> || <color>",
  ["a-width", "a-style", "a-colour"],
  [
    { longhands: ["a-width"], words: ["thin", "medium", "thick"], types: ["length"] },
    { longhands: ["a-style"], words: ["none", "solid", "dashed"] },
    { longhands: ["a-colour"], types: ["color"] },
  ],
);

describe("a value written in any order", () => {
  test("each token reaches its own longhand", () => {
    expect(splitByGrammar(BORDER, "1px solid red")).toEqual({
      "a-width": "1px",
      "a-style": "solid",
      "a-colour": "red",
    });
  });

  test("and the order it was written in does not matter", () => {
    expect(splitByGrammar(BORDER, "red 1px solid")).toEqual({
      "a-width": "1px",
      "a-style": "solid",
      "a-colour": "red",
    });
  });

  /** A longhand no part of the grammar reached is reset, which is what the shorthand does to it. */
  test("a longhand nothing reached is reset", () => {
    expect(splitByGrammar(BORDER, "solid")).toEqual({
      "a-width": "initial",
      "a-style": "solid",
      "a-colour": "initial",
    });
  });
});

/**
 * A SEPARATOR is read, which is the shape a slot list cannot hold.
 *
 * `mask` is `<bg-position> [ / <bg-size> ]?`. Without the slash `center / cover` and
 * `center cover` are the same three tokens and the second longhand cannot be told from the first.
 */
describe("a separator inside the grammar", () => {
  const SLASHED = shape(
    "<length> [ / <length> ]?",
    ["a-pos", "a-size"],
    [{ longhands: ["a-pos"], types: ["length"] }, { longhands: ["a-size"], types: ["length"] }],
  );

  test("tells the part after it from the part before", () => {
    expect(splitByGrammar(SLASHED, "1px / 2px")).toEqual({ "a-pos": "1px", "a-size": "2px" });
  });

  test("and without it the second part is not reached", () => {
    expect(splitByGrammar(SLASHED, "1px")).toEqual({ "a-pos": "1px", "a-size": "initial" });
  });

  test("a value the grammar cannot read at all is refused", () => {
    expect(splitByGrammar(SLASHED, "1px 2px")).toBeUndefined();
  });
});

/**
 * BACKTRACKING, which is the whole reason this is a parse.
 *
 * The first part takes the first token happily and then nothing takes the second, so the first
 * choice has to be given up. A slot list cannot do this: a slot that has taken a token keeps it.
 */
describe("a first choice that dead-ends", () => {
  const EITHER = shape(
    "[ <custom-ident> | <length> ] <length>",
    ["a-name", "a-size"],
    [
      { longhands: ["a-name"], types: ["custom-ident"], open: true },
      { longhands: ["a-name"], types: ["length"] },
      { longhands: ["a-size"], types: ["length"] },
    ],
  );

  test("is given up so the rest can be read", () => {
    expect(splitByGrammar(EITHER, "1px 2px")).toEqual({ "a-name": "1px", "a-size": "2px" });
  });
});

describe("a comma-separated family", () => {
  const LIST = shape(
    "<custom-ident> <time>",
    ["a-name", "a-time"],
    [{ longhands: ["a-name"], types: ["custom-ident"], open: true }, { longhands: ["a-time"], types: ["time"] }],
    true,
  );

  test("every longhand takes a list the same length", () => {
    expect(splitByGrammar(LIST, "spin 1s, slide 2s")).toEqual({
      "a-name": "spin, slide",
      "a-time": "1s, 2s",
    });
  });

  /**
   * An item that missed a longhand needs the RESET written as a value: `initial` is a CSS-wide
   * keyword and cannot stand as one item of a list. `a-time` is no property, so no measured value
   * exists for it and the whole value is refused rather than guessed at.
   */
  test("an item that missed a longhand refuses where no initial value is known", () => {
    expect(splitByGrammar(LIST, "spin 1s, slide")).toBeUndefined();
  });

  /**
   * One unreadable item refuses the WHOLE value. Dropping it would shorten one longhand's list
   * while the others stayed long, and the lists are matched by POSITION — so every item after the
   * gap would silently take another item's value.
   */
  test("and one item it cannot read refuses all of them", () => {
    expect(splitByGrammar(LIST, "spin 1s, ??? ???")).toBeUndefined();
  });

  /**
   * A longhand the family resets ONCE rather than once per item.
   *
   * `animation: 4s, 9s` gives `animation-duration: 4s, 9s` and `animation-timeline: auto` — one
   * value for two items. Which longhands do that is MEASURED and carried in the shape, because the
   * grammar does not say: `animation-timeline` has a part in the item and `animation-range-start`
   * has none, and both behave this way. A rule written from the grammar got the first one wrong.
   */
  test("a longhand the family resets once does not line up with the items", () => {
    const ONCE = shape(
      "<custom-ident> <time>",
      ["a-name", "a-time", "a-line"],
      [{ longhands: ["a-name"], types: ["custom-ident"], open: true }, { longhands: ["a-time"], types: ["time"] }],
      true,
    );

    expect(splitByGrammar({ ...ONCE, resetOnce: ["a-line"] }, "spin 1s, slide 2s")).toEqual({
      "a-name": "spin, slide",
      "a-time": "1s, 2s",
      "a-line": "initial",
    });
  });

  /** Real longhand names, because a reset that lines up needs a measured initial value to write. */
  test("and one that is not named keeps lining up, even where no item wrote it", () => {
    const BOTH = shape(
      "<custom-ident> <time>?",
      ["animation-name", "animation-duration"],
      [
        { longhands: ["animation-name"], types: ["custom-ident"], open: true },
        { longhands: ["animation-duration"], types: ["time"] },
      ],
      true,
    );

    expect(splitByGrammar({ ...BOTH, resetOnce: [] }, "spin, slide 2s")?.["animation-duration"]).toBe("0s, 2s");
  });

  test("a family that is not a list refuses a comma outright", () => {
    expect(splitByGrammar(BORDER, "1px solid red, 2px")).toBeUndefined();
  });
});

/**
 * An OPEN leaf standing BEFORE the leaf that means the token.
 *
 * `list-style` is exactly this: `list-style-type` takes a free identifier and is named first, and
 * `list-style: url(a.png)` is an image. Asking the slots in grammar order instead of closed-first
 * would fix `animation: --zz` and break this, which is why the answer had to be a parse.
 */
describe("an open leaf does not eat what it cannot be", () => {
  const LISTY = shape(
    "[ none | <custom-ident> ] || <url>",
    ["a-type", "a-image"],
    [
      { longhands: ["a-type"], words: ["none"] },
      { longhands: ["a-type"], types: ["custom-ident"], open: true },
      { longhands: ["a-image"], types: ["url"] },
    ],
  );

  test("a call belongs to the leaf that takes calls", () => {
    expect(splitByGrammar(LISTY, "url(a.png)")).toEqual({ "a-type": "initial", "a-image": "url(a.png)" });
  });

  test("an identifier still reaches the open leaf", () => {
    expect(splitByGrammar(LISTY, "upper-roman")).toEqual({ "a-type": "upper-roman", "a-image": "initial" });
  });

  /** A dimension is not an identifier either, so the open leaf leaves it alone and the value is refused. */
  test("and a dimension is not an identifier", () => {
    expect(splitByGrammar(LISTY, "4px")).toBeUndefined();
  });
});

/**
 * An open leaf standing down for the leaf that NAMES the word.
 *
 * `transition`'s `<single-transition-property>` takes a free identifier and is named first, so it
 * ate every easing keyword written alone — measured, `transition: linear` set the property to
 * `linear` where all three engines set the timing function. An open leaf loses to an exact word
 * anywhere in the grammar and still wins over a type, which is the pair `animation: --zz` and
 * `transition: linear` together demand.
 */
describe("an open leaf loses to a word and beats a type", () => {
  const TRANSITION = shape(
    "[ none | <custom-ident> ] || <time> || <easing> || <dashed-ident>",
    ["a-prop", "a-time", "a-ease", "a-line"],
    [
      { longhands: ["a-prop"], words: ["none"] },
      { longhands: ["a-prop"], types: ["custom-ident"], open: true },
      { longhands: ["a-time"], types: ["time"] },
      { longhands: ["a-ease"], words: ["linear", "ease"] },
      { longhands: ["a-line"], types: ["dashed-ident"] },
    ],
  );

  test("a word another leaf names goes to that leaf", () => {
    expect(splitByGrammar(TRANSITION, "linear")?.["a-ease"]).toBe("linear");
  });

  test("and the open leaf still takes a word nobody names", () => {
    expect(splitByGrammar(TRANSITION, "colour")?.["a-prop"]).toBe("colour");
  });

  test("while a type does not take it off the open leaf", () => {
    expect(splitByGrammar(TRANSITION, "--zz")?.["a-prop"]).toBe("--zz");
  });

  /**
   * A named COLOUR is a word too, and this is where drawing the line at "any other leaf accepts
   * it" would have been wrong in the other direction. `text-emphasis` is
   * `<'text-emphasis-style'> || <'text-emphasis-color'>` with an open style leaf named first, and
   * `rebeccapurple` went to the style until the colour names were counted as names.
   */
  test("a named colour takes the token off an open leaf", () => {
    const EMPHASIS = shape(
      "[ none | <string> ] || <color>",
      ["a-style", "a-colour"],
      [
        { longhands: ["a-style"], words: ["none"] },
        { longhands: ["a-style"], types: ["string", "custom-ident"], open: true },
        { longhands: ["a-colour"], types: ["color"] },
      ],
    );

    expect(splitByGrammar(EMPHASIS, "rebeccapurple")?.["a-colour"]).toBe("rebeccapurple");
  });
});

/**
 * A value the ENGINES read differently from each other, which no one split can satisfy.
 *
 * `animation: auto` is the measured case. Firefox puts `auto` in `animation-name`; Chromium and
 * WebKit put it nowhere, leaving both longhands at their initial. Writing either answer is wrong in
 * some browser, so the value keeps its shorthand — and `animation: spin 1s`, which nothing disputes,
 * splits as usual. Refusing the whole FAMILY for one value is what this replaced.
 */
describe("a contested value", () => {
  const DISPUTED = shape(
    "<time> || <custom-ident>",
    ["a-time", "a-name"],
    [
      { longhands: ["a-time"], words: ["auto"], types: ["time"] },
      { longhands: ["a-name"], types: ["custom-ident"], open: true },
    ],
  );
  const WITH = { ...DISPUTED, contested: ["auto"] };

  test("is refused, where the same shape without the dispute would split it", () => {
    expect(splitByGrammar(DISPUTED, "auto")).toBeDefined();
    expect(splitByGrammar(WITH, "auto")).toBeUndefined();
  });

  /** Written SECOND, because a check that reads only the first token passes the other way round. */
  test("and it is refused wherever it stands in the value", () => {
    expect(splitByGrammar(DISPUTED, "spin auto")).toBeDefined();
    expect(splitByGrammar(WITH, "spin auto")).toBeUndefined();
    expect(splitByGrammar(WITH, "auto spin")).toBeUndefined();
  });

  test("while every other value of the family still splits", () => {
    expect(splitByGrammar(WITH, "1s spin")).toEqual({ "a-time": "1s", "a-name": "spin" });
  });

  test("the spelling is the token's, whatever case it was written in", () => {
    expect(splitByGrammar(WITH, "AUTO")).toBeUndefined();
  });
});

describe("what it refuses", () => {
  test("a `var()`, whose content is unknown until the browser reads it", () => {
    expect(splitByGrammar(BORDER, "var(--x)")).toBeUndefined();
  });

  test("a token no part of the grammar takes", () => {
    expect(splitByGrammar(BORDER, "1px wobbly")).toBeUndefined();
  });

  /** A CSS-wide keyword is not a component value: it goes on every longhand, or nowhere. */
  test("a CSS-wide keyword goes on every longhand", () => {
    expect(splitByGrammar(BORDER, "inherit")).toEqual({
      "a-width": "inherit",
      "a-style": "inherit",
      "a-colour": "inherit",
    });
  });

  test("and beside a real value it is refused, because CSS has no such form either", () => {
    expect(splitByGrammar(BORDER, "1px inherit")).toBeUndefined();
  });

  /**
   * The tree and the descriptions are written into the table together, so a count that disagrees
   * is a corrupt table rather than a value this cannot read. Refusing says so without guessing
   * which leaf lost its description — every leaf after the gap would take the wrong one.
   */
  test("a shape whose descriptions do not match its tree", () => {
    const wrong = { ...BORDER, leaves: BORDER.leaves.slice(0, 2) };

    expect(splitByGrammar(wrong, "1px solid red")).toBeUndefined();
  });
});
