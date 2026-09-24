import { describe, expect, test } from "vitest";
import { acceptedBy, isOpen, longhandsFor, resolving } from "../compiler/classify";
import { componentsOf, parseValueSyntax } from "../compiler/valueSyntax";

/**
 * Which longhand a component of a shorthand's grammar feeds.
 *
 * The grammars here are written out rather than read from `mdn-data`, so a test says what it is
 * about: each one is the published grammar of the family it names, and each case below is a rule
 * that a measurement found missing on that family.
 */

/** A tiny grammar table, standing in for the one the build reads. */
const table = (rows: Record<string, string>) => resolving((property) => rows[property] ?? "");

const componentsIn = (source: string) => componentsOf(parseValueSyntax(source));

describe("a component that names a property", () => {
  test("names one of the family's own longhands", () => {
    const [term] = componentsIn("<'flex-grow'>");

    expect(longhandsFor(term, ["flex-grow", "flex-shrink"], table({}))).toEqual(["flex-grow"]);
  });

  /**
   * `border-block-end`'s grammar names `<'border-top-width'>`, which is not one of its longhands —
   * it means "a value of that kind". The family's own width longhand is what it feeds.
   */
  test("or another property, whose values are the same", () => {
    const grammars = table({ "border-top-width": "<line-width>", "border-block-end-width": "<line-width>" });
    const [term] = componentsIn("<'border-top-width'>");

    expect(longhandsFor(term, ["border-block-end-width", "border-block-end-color"], grammars)).toEqual([
      "border-block-end-width",
    ]);
  });

  test("and where the grammars do not match, the name's own tail carries it", () => {
    const [term] = componentsIn("<'border-top-style'>");

    expect(longhandsFor(term, ["border-block-end-style", "border-block-end-color"], table({}))).toEqual([
      "border-block-end-style",
    ]);
  });
});

describe("a component that names a type", () => {
  test("the longhand whose own grammar asks for it", () => {
    const grammars = table({ "border-bottom-width": "<line-width>", "border-bottom-style": "<line-style>" });
    const [term] = componentsIn("<line-style>");

    expect(longhandsFor(term, ["border-bottom-width", "border-bottom-style"], grammars)).toEqual([
      "border-bottom-style",
    ]);
  });

  /**
   * A longhand's grammar can be a REFERENCE — `border-bottom-color` is written
   * `<'border-top-color'>`. Matching `<color>` against that text finds nothing, and the component
   * was then resolved into its own alternatives: `border-bottom` came out with 222 of them.
   */
  test("through a reference, because a longhand's grammar can be one", () => {
    const grammars = table({ "border-bottom-color": "<'border-top-color'>", "border-top-color": "<color>" });
    const [term] = componentsIn("<color>");

    expect(longhandsFor(term, ["border-bottom-color"], grammars)).toEqual(["border-bottom-color"]);
  });

  test("several longhands may take one type, which is not a fault", () => {
    const grammars = table({ "border-top-width": "<line-width>", "border-left-width": "<line-width>" });
    const [term] = componentsIn("<line-width>");

    expect(longhandsFor(term, ["border-top-width", "border-left-width"], grammars)).toHaveLength(2);
  });
});

describe("a component that is a keyword", () => {
  test("the longhand whose grammar lists it", () => {
    const grammars = table({ "grid-auto-flow": "[ row | column ] || dense", "grid-auto-rows": "<track-size>" });
    const [term] = componentsIn("dense");

    expect(longhandsFor(term, ["grid-auto-flow", "grid-auto-rows"], grammars)).toEqual(["grid-auto-flow"]);
  });

  /**
   * The odd rule, and the reason this is not a lookup. `font-synthesis: weight` does not give
   * `font-synthesis-weight` the VALUE `weight` — it turns it on. No grammar mentions the word, so
   * every other rule draws a blank and the family read as unclassifiable until this was added.
   */
  test("or, where no grammar mentions it, the longhand it NAMES", () => {
    const grammars = table({ "font-synthesis-weight": "auto | none", "font-synthesis-style": "auto | none" });
    const [term] = componentsIn("weight");

    expect(longhandsFor(term, ["font-synthesis-weight", "font-synthesis-style"], grammars)).toEqual([
      "font-synthesis-weight",
    ]);
  });

  test("a word is matched whole, so `style` does not answer for `font-style`", () => {
    const grammars = table({ "a-style": "solid | dashed", "b-thing": "font-style" });
    const [term] = componentsIn("style");

    expect(longhandsFor(term, ["a-style", "b-thing"], grammars)).toEqual(["a-style"]);
  });
});

describe("a component that is a function", () => {
  /** `font-variant-alternates` is the longhand whose grammar calls `stylistic()`. */
  test("the longhand whose grammar calls it", () => {
    const grammars = table({
      "font-variant-alternates": "normal | stylistic( <custom-ident> )",
      "font-variant-caps": "normal | small-caps",
    });
    const [term] = componentsIn("stylistic( <custom-ident> )");

    expect(longhandsFor(term, ["font-variant-alternates", "font-variant-caps"], grammars)).toEqual([
      "font-variant-alternates",
    ]);
  });

  test("a function nobody calls", () => {
    const [term] = componentsIn("nope( <length> )");

    expect(longhandsFor(term, ["a-width"], table({ "a-width": "<length>" }))).toEqual([]);
  });
});

describe("what claims nothing", () => {
  test("a literal is not a component and feeds nobody", () => {
    const term = parseValueSyntax("/");

    expect(longhandsFor(term, ["a", "b"], table({}))).toEqual([]);
  });

  test("a type no longhand asks for", () => {
    const [term] = componentsIn("<position>");

    expect(longhandsFor(term, ["a-width"], table({ "a-width": "<length>" }))).toEqual([]);
  });
});

describe("following a property's grammar", () => {
  test("a chain of references is walked to the end", () => {
    const grammars = table({ a: "<'b'>", b: "<'c'>", c: "<color>" });

    expect(grammars("a")).toBe("<color>");
  });

  /** A cycle must end rather than hang, and the depth cap is what ends it. */
  test("a cycle stops instead of hanging", () => {
    const grammars = table({ a: "<'b'>", b: "<'a'>" });

    expect(typeof grammars("a")).toBe("string");
  });

  test("a property nothing knows about reads as empty", () => {
    expect(table({})("nope")).toBe("");
  });
});

describe("what a component accepts, so a token can be recognised as it", () => {
  /** A tiny grammar table for named types, standing in for `mdn.css.syntaxes`. */
  const grammars = (rows: Record<string, string>) => (name: string) => rows[name] ?? "";

  const accepts = (source: string, rows: Record<string, string> = {}) =>
    acceptedBy(parseValueSyntax(source), grammars(rows));

  test("a closed list of words", () => {
    const answer = accepts("<line-style>", { "line-style": "none | dotted | dashed | solid" });

    expect(answer.words).toEqual(["none", "dotted", "dashed", "solid"]);
    expect(answer.types).toEqual([]);
  });

  test("words and a primitive together", () => {
    const answer = accepts("<line-width>", { "line-width": "<length> | thin | medium | thick" });

    expect(answer.words).toEqual(["thin", "medium", "thick"]);
    expect(answer.types).toEqual(["length"]);
  });

  test("a type with no grammar of its own IS the answer", () => {
    expect(accepts("<length>").types).toEqual(["length"]);
  });

  test("named types are followed to the bottom", () => {
    const answer = accepts("<a>", { a: "<b> | one", b: "<length> | two" });

    expect([...answer.words].sort()).toEqual(["one", "two"]);
    expect(answer.types).toEqual(["length"]);
  });

  test("a function is kept as a function", () => {
    expect(accepts("<c>", { c: "red | rgb( <number> )" })).toMatchObject({
      words: ["red"],
      functions: ["rgb"],
    });
  });

  /**
   * CSS's grammars refer to each other and `<calc-sum>` refers to itself. A resolver with no cap
   * and no memory of where it has been does not return.
   */
  /**
   * A nested alternation is still one flat set of choices.
   *
   * `alternativesOf` splits on `|` and hands back each branch, but a branch may be an alternation
   * itself — `[ a | b ] | c` gives back a group and a word, not three words. Measured, because the
   * shape of what comes back is the parser's business and not this file's to assume.
   */
  test("an alternation inside an alternation is flattened, not dropped", () => {
    expect([...accepts("<a>", { a: "[ one | two ] | three" }).words].sort()).toEqual(["one", "three", "two"]);
  });

  test("a grammar that refers to itself ends", () => {
    expect(() => accepts("<loop>", { loop: "<loop> | done" })).not.toThrow();
    expect(accepts("<loop>", { loop: "<loop> | done" }).words).toEqual(["done"]);
  });

  test("a grammar this cannot read is a type it cannot open, which is still an answer", () => {
    expect(accepts("<odd>", { odd: "@nope" }).types).toEqual(["odd"]);
  });

  /**
   * `<keyframes-name>` is a `custom-ident`, which is to say any word. A component like that says
   * yes to nearly everything, so it is asked last — which is what puts `spin` in `animation-name`
   * without a list of animation names, a list that could not exist.
   */
  test("a component that takes a free identifier is known as open", () => {
    expect(isOpen(accepts("<keyframes-name>", { "keyframes-name": "<custom-ident> | <string>" }))).toBe(true);
  });

  test("and a closed one is not", () => {
    expect(isOpen(accepts("<line-style>", { "line-style": "none | solid" }))).toBe(false);
  });
});
