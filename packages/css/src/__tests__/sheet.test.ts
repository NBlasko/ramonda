import { describe, expect, test } from "vitest";
import { type EmittedBlock, transform } from "../compiler/transform";
import { CssBlockError } from "../compiler/errors";
import { BREADTH_LAYERS, LAYER_ORDER, layerPathFor } from "../compiler/flatten";

/**
 * The layer a rule lands in, from the same function the sheet uses.
 *
 * Written out as `u11` once, and it stopped being `u11` the moment the shorthand table grew — the
 * name is an index into the breadths, so hard-coding it made a test about the generated data rather
 * than about the sheet.
 */
const layerOf = (block: Parameters<typeof layerPathFor>[0]) => layerPathFor(block).join(".");
import { escapeClass } from "../compiler/names";
import { Sheet } from "../compiler/sheet";

/**
 * Assembly: the one place the whole picture exists.
 *
 * The transform is deliberately local — it reads one file and knows nothing about any other, which
 * is what makes it cacheable and incremental. Every question that needs to see everything at once
 * therefore lives here and nowhere else, and there are three of them: dedupe, the collision
 * assertion, and the round trip.
 */

const block = (className: string, css: string, properties: string[] = []): EmittedBlock => ({
  className,
  css,
  properties,
});

const FLEX = block("r-1111111111111111", "display:flex;");
const GRID = block("r-2222222222222222", "display:grid;");

describe("dedupe", () => {
  test("the same block from two files is one rule", () => {
    const sheet = new Sheet();
    sheet.add("a.tsx", [FLEX]);
    sheet.add("b.tsx", [FLEX]);

    expect(sheet.css()).toBe(
      `${LAYER_ORDER}\n@layer ramonda {\n@layer ${layerOf(FLEX)} {\n.r-1111111111111111 { display:flex; }\n}\n}\n`,
    );
  });

  test("and the same block twice in one file is too", () => {
    const sheet = new Sheet();
    sheet.add("a.tsx", [FLEX, FLEX]);

    expect(sheet.css().match(/\.r-1111111111111111/g)).toHaveLength(1);
  });

  test("two different blocks are two rules, in the order they arrived", () => {
    const sheet = new Sheet();
    sheet.add("a.tsx", [GRID]);
    sheet.add("b.tsx", [FLEX]);

    expect(sheet.css()).toContain(`.r-2222222222222222 { display:grid; }\n.r-1111111111111111 { display:flex; }`);
  });
});

describe("the collision assertion, which is the actual guarantee", () => {
  /**
   * A longer hash makes a collision unlikely, not impossible — probability is not a promise. This is
   * the promise: assembly sees every block at once, so "no two distinct blocks share a class" is a
   * fact the build can CHECK rather than hope for. The 16-hex name only decides that it never fires.
   */
  test("two different blocks under one class name fail the build", () => {
    const sheet = new Sheet();
    sheet.add("a.tsx", [FLEX]);

    expect(() => sheet.add("b.tsx", [block(FLEX.className, "display:grid;")])).toThrow(CssBlockError);
  });

  test("and the refusal names both files, because either one could be the one to change", () => {
    const sheet = new Sheet();
    sheet.add("Card.tsx", [FLEX]);

    try {
      sheet.add("Panel.tsx", [block(FLEX.className, "display:grid;")]);
      expect.unreachable("the sheet should have refused");
    } catch (error) {
      expect((error as CssBlockError).message).toContain("Card.tsx");
      expect((error as CssBlockError).message).toContain("Panel.tsx");
    }
  });
});

describe("re-adding a file, which is what a dev server does on every save", () => {
  test("a rule the file no longer has is dropped", () => {
    const sheet = new Sheet();
    sheet.add("a.tsx", [FLEX, GRID]);
    sheet.add("a.tsx", [FLEX]);

    expect(sheet.css()).toContain("display:flex;");
    expect(sheet.css()).not.toContain("display:grid;");
  });

  test("a rule another file still has survives", () => {
    const sheet = new Sheet();
    sheet.add("a.tsx", [FLEX]);
    sheet.add("b.tsx", [FLEX]);
    sheet.add("a.tsx", []);

    expect(sheet.css()).toContain("display:flex;");
  });

  test("and the class it freed can be claimed by different declarations afterwards", () => {
    // The collision assertion is about two blocks that BOTH exist. A file that stopped using one has
    // stopped asserting anything about its name — otherwise editing a block would poison the name it
    // used to have until the server restarted.
    const sheet = new Sheet();
    sheet.add("a.tsx", [FLEX]);
    sheet.add("a.tsx", [block(FLEX.className, "display:grid;")]);

    expect(sheet.css()).toContain("display:grid;");
  });
});

describe("the round trip, asked of whatever came back from post-processing", () => {
  /**
   * A minifier is allowed to merge and rename rules, and the markup already names the classes — so a
   * rule that vanished or was renamed means shipping HTML that points at a class which is not there.
   * The failure is invisible: the page renders, unstyled, with nothing to blame.
   */
  const sheet = new Sheet();
  sheet.add("a.tsx", [block("r-3333333333333333", "color:var(--r-3333333333333333-0);", ["--r-3333333333333333-0"])]);

  test("passes when every class and every variable is still there", () => {
    expect(() => sheet.verify(".r-3333333333333333{color:var(--r-3333333333333333-0)}")).not.toThrow();
  });

  test("fails on a class that was renamed away", () => {
    expect(() => sheet.verify(".x{color:var(--r-3333333333333333-0)}")).toThrow(CssBlockError);
  });

  test("fails on a variable reference that was dropped", () => {
    expect(() => sheet.verify(".r-3333333333333333{color:red}")).toThrow(CssBlockError);
  });

  test("a merged selector is fine, because merging keeps the name", () => {
    expect(() => sheet.verify(".a,.r-3333333333333333{color:var(--r-3333333333333333-0)}")).not.toThrow();
  });

  test("and it says what is missing rather than that something is", () => {
    try {
      sheet.verify(".x{color:red}");
      expect.unreachable("the sheet should have refused");
    } catch (error) {
      expect((error as CssBlockError).message).toContain("r-3333333333333333");
    }
  });
});

describe("after a collision has already failed the build", () => {
  /**
   * `add` throws partway through, so the file's class list is still the old one while the rules map
   * has moved on. A dev server keeps going after a failed transform and will call `add` again, and a
   * stale name in that list must not take the next call down with it.
   */
  test("the next add does not trip over what the failed one left behind", () => {
    const sheet = new Sheet();
    sheet.add("a.tsx", [FLEX]);
    sheet.add("b.tsx", [GRID]);

    expect(() => sheet.add("b.tsx", [block(FLEX.className, "display:grid;")])).toThrow(CssBlockError);

    // `b.tsx` still lists `r-2222…`, which the failed call removed from the rules.
    expect(() => sheet.add("b.tsx", [GRID])).not.toThrow();
    expect(sheet.css()).toContain("display:grid;");
  });
});

describe("the layers", () => {
  /**
   * Layers UNDER `ramonda`, which is still one name to an app: everything generated is beneath
   * everything unlayered — which is every hand-written stylesheet — so an author's own
   * `.card { display: block }` wins over a generated rule whatever order the files load in, and
   * `@layer reset, ramonda, app;` still places the whole of it in one line. Both measured in
   * Chromium, before and after the sub-layers, in `prototype-layers.mjs`.
   */
  test("every rule sits in one of them, beneath the app's own CSS", () => {
    const sheet = new Sheet();
    sheet.add("a.tsx", [FLEX, GRID]);

    const css = sheet.css();
    expect(css.startsWith(`${LAYER_ORDER}\n@layer ramonda {\n`)).toBe(true);
    expect(css.endsWith("}\n")).toBe(true);
    // Every rule is inside `ramonda`, so nothing generated is ever unlayered.
    expect(css.indexOf(".r-")).toBeGreaterThan(css.indexOf("@layer ramonda {"));
  });

  /**
   * The statement is what makes the order the same in every stylesheet, and a file declares the
   * WHOLE list rather than what it uses.
   *
   * Measured in Chromium, and a subset is worse than useless: a file holding only `margin-left`,
   * loading before one holding `margin` and `margin-left`, put the shorthand's layer AFTER the
   * longhand's, because CSS appends a name it has not seen to the end of the order — `4px` became
   * `0px`. With no statement at all the order is first-USE order, which fails the same way.
   */
  test("the statement declares every layer, not the ones this file uses", () => {
    const sheet = new Sheet();
    sheet.add("a.tsx", [FLEX]);

    const declared = sheet.cssFor("a.tsx").split("\n")[0];
    expect(declared).toBe(LAYER_ORDER);
    // Every breadth an unconditional rule can have, and one for everything conditional.
    expect(declared.match(/ramonda\.u/g)).toHaveLength(BREADTH_LAYERS.length);
    expect(declared).toContain("ramonda.c;");
  });

  /**
   * The fault this exists for, at the level the sheet can be asked about it: one rule in two files'
   * stylesheets, and the second file must not be able to move it.
   *
   * Measured in Chromium through a real build before the layers: `Card.tsx` writing `color: red` and
   * `@media { color: blue }` rendered blue on its own and red once `Panel.tsx` — which writes only
   * `color: red` — loaded after it. The layers put the two in different layers, so the sequence they
   * land in decides nothing.
   */
  test("a conditional rule and an unconditional one are in different layers", () => {
    const sheet = new Sheet();
    const RED = { ...block("r-6666666666666666", "color:red;"), property: "color" };
    const BLUE = {
      ...block("r-7777777777777777", "color:blue;"),
      property: "color",
      conditions: ["@media (min-width:1px)"],
    };
    sheet.add("Card.tsx", [RED, BLUE]);
    sheet.add("Panel.tsx", [RED]);

    const card = sheet.cssFor("Card.tsx");
    // The unconditional one is one level down; the conditional one is under `c`, which is declared
    // after every `u`, so it wins wherever it applies.
    expect(card).toMatch(/@layer u\d+ \{\n\.r-6666/);
    expect(card).toContain("@layer c {");
    expect(card.indexOf("@layer c {")).toBeGreaterThan(card.indexOf(".r-6666"));

    // And the file that writes only the shared rule declares the same order.
    expect(sheet.cssFor("Panel.tsx").startsWith(LAYER_ORDER)).toBe(true);
  });

  /**
   * Two breakpoints for one property, which is what the layers alone could not settle: they are both
   * conditional and neither is a shorthand, so they used to rank the same and the sheet fell back to
   * the order the file wrote — which another file re-emitting one of the two then reversed.
   *
   * The width is read off the query now, so the wider `min-width` is later whatever the file did.
   * Measured in Chromium over 900 load orders across three files: zero wrong.
   */
  test("two breakpoints go in different layers, the wider one later", () => {
    const sheet = new Sheet();
    const at = (query: string, className: string, value: string) => ({
      ...block(className, `padding:${value};`),
      property: "padding",
      conditions: [query],
    });
    const NARROW = at("@media (min-width: 40rem)", "r-8888888888888888", "1rem");
    const WIDE = at("@media (min-width: 64rem)", "r-9999999999999999", "2rem");

    // Written wide-first, so the file's own order is the opposite of the one that must come out.
    sheet.add("Card.tsx", [WIDE, NARROW]);

    const css = sheet.cssFor("Card.tsx");
    expect(css.indexOf("40rem")).toBeLessThan(css.indexOf("64rem"));

    // A second file writing only the narrow one cannot put it after the wide one, because the layer
    // it lands in was declared before the wide one's in every stylesheet.
    sheet.add("Panel.tsx", [NARROW]);
    expect(sheet.cssFor("Panel.tsx")).toContain("40rem");
  });

  test("an empty sheet is empty text, not an empty layer", () => {
    expect(new Sheet().css()).toBe("");
  });
});

/**
 * A named site — `@@keyframes( … )`, `@@font-face( … )`, `@@property( … )` — is a rule with a name
 * instead of a rule on a class, and the name is still the hash. Everything the sheet does for a
 * class block it must do for these: dedupe them, refuse a collision, drop them on a save, and ask
 * post-processing for them back. The only difference is one line of syntax, and it is the line the
 * author never writes.
 */
describe("a named rule", () => {
  const SLIDE = { ...block("r-4444444444444444", "from{opacity:0;}to{opacity:1;}"), at: "keyframes" };
  const FACE = { ...block("r-5555555555555555", "src:url(a.woff2);"), at: "font-face" };

  test("is written as its at-rule, not as a class", () => {
    const sheet = new Sheet();
    sheet.add("a.tsx", [SLIDE]);

    expect(sheet.css()).toBe(
      `${LAYER_ORDER}\n@layer ramonda {\n@layer ${layerOf(SLIDE)} {\n@keyframes r-4444444444444444 { from{opacity:0;}to{opacity:1;} }\n}\n}\n`,
    );
  });

  test("and one whose at-rule takes no name carries none", () => {
    const sheet = new Sheet();
    sheet.add("a.tsx", [FACE]);

    expect(sheet.css()).toContain("@font-face { src:url(a.woff2); }");
    expect(sheet.css()).not.toContain("r-5555555555555555");
  });

  test("is served by every file that names it, like any other rule", () => {
    const sheet = new Sheet();
    sheet.add("a.tsx", [SLIDE]);
    sheet.add("b.tsx", [SLIDE]);

    expect(sheet.cssFor("a.tsx")).toContain("@keyframes r-4444444444444444");
    expect(sheet.cssFor("b.tsx")).toContain("@keyframes r-4444444444444444");
  });

  test("is asked for by name after post-processing, since it has no class to look for", () => {
    const sheet = new Sheet();
    sheet.add("a.tsx", [SLIDE]);

    expect(() => sheet.verify("@keyframes r-4444444444444444{from{opacity:0}to{opacity:1}}")).not.toThrow();
    expect(() => sheet.verify("@keyframes r-9999999999999999{}")).toThrow(CssBlockError);
  });

  test("and a nameless one is asked for by its at-rule", () => {
    const sheet = new Sheet();
    sheet.add("a.tsx", [FACE]);

    expect(() => sheet.verify("@font-face{src:url(a.woff2)}")).not.toThrow();
    expect(() => sheet.verify(".r-1 { color: red }")).toThrow(CssBlockError);
  });
});

/**
 * The round trip for a rule with NO name, which is the one that could be counted wrong.
 *
 * A class is looked for by its selector and a `@keyframes` by its name. A `@font-face` has neither —
 * the only thing it can be asked for is its at-rule — so two of them look exactly like one, and
 * measured before this was written: with two in the sheet and one dropped by post-processing,
 * `verify` passed. The promise is that every rule survived, so the question has to be how MANY.
 */
describe("verifying rules that have no name", () => {
  const A = { ...block("r-6666666666666666", 'font-family:"A";src:url(/a.woff2);'), at: "font-face" };
  const B = { ...block("r-7777777777777777", 'font-family:"B";src:url(/b.woff2);'), at: "font-face" };

  test("two survive as two", () => {
    const sheet = new Sheet();
    sheet.add("a.tsx", [A, B]);

    expect(() => sheet.verify("@font-face{font-family:A}@font-face{font-family:B}")).not.toThrow();
  });

  test("and one of two coming back is a failure, not a pass", () => {
    const sheet = new Sheet();
    sheet.add("a.tsx", [A, B]);

    expect(() => sheet.verify("@font-face{font-family:A}")).toThrow(CssBlockError);
  });

  test("the refusal says how many went missing", () => {
    const sheet = new Sheet();
    sheet.add("a.tsx", [A, B]);

    expect(() => sheet.verify("@font-face{font-family:A}")).toThrow(/1 of the 2/);
  });

  /**
   * SHARED BY TWO FILES, which is where counting occurrences stops working.
   *
   * Every file that names a rule serves it, so the shipped text holds one copy per SERVING and not
   * one per rule — and neither esbuild nor lightningcss merges identical `@font-face` blocks
   * (measured, all three copies survive both). So two rules across three servings shipped three
   * occurrences, `expected` was 2, and dropping one of the two rules still left 2 >= 2. The hole the
   * counting was written to close came back the moment a nameless rule was shared.
   *
   * What is asked instead is how many DISTINCT bodies came back. Servings collapse into one, so
   * duplication cannot inflate it; a rule that was dropped takes its body with it.
   */
  describe("and one shared by two files, which is what defeated the count", () => {
    const shipped = (...bodies: string[]) => bodies.map((one) => `@font-face{${one}}`).join("");

    test("three servings of two rules is not three rules", () => {
      const sheet = new Sheet();
      sheet.add("a.tsx", [A, B]);
      sheet.add("b.tsx", [A]);

      // What a build ships: A, B, and A again — and then B is dropped.
      expect(() => sheet.verify(shipped("font-family:A", "font-family:A"))).toThrow(CssBlockError);
    });

    test("and all of them coming back is a pass, however many times each is served", () => {
      const sheet = new Sheet();
      sheet.add("a.tsx", [A, B]);
      sheet.add("b.tsx", [A]);

      expect(() => sheet.verify(shipped("font-family:A", "font-family:B", "font-family:A"))).not.toThrow();
    });

    /**
     * A bundler may emit ONE asset for two chunks whose CSS is identical — measured on a real build,
     * two routes writing the same block ended up pointing at one stylesheet. So the shipped text can
     * hold FEWER copies than there are servings, and expecting one per serving would refuse a
     * correct build.
     */
    test("and fewer copies than servings is not a failure", () => {
      const sheet = new Sheet();
      sheet.add("a.tsx", [A]);
      sheet.add("b.tsx", [A]);

      expect(() => sheet.verify(shipped("font-family:A"))).not.toThrow();
    });

    /** An at-rule with no body came back as no rule, whatever the word `@font-face` is doing there. */
    test("the at-rule's name with no body after it is not a rule that came back", () => {
      const sheet = new Sheet();
      sheet.add("a.tsx", [A]);

      expect(() => sheet.verify("@font-face")).toThrow(/1 of the 1/);
    });

    /**
     * The body is not compared, because a minifier rewrites it: measured, lightningcss turned
     * `unicode-range: U+0000-00FF` into `U+??`. Only how many distinct ones came back is asked.
     */
    test("a body the minifier rewrote is still a body", () => {
      const sheet = new Sheet();
      sheet.add("a.tsx", [A, B]);

      expect(() => sheet.verify(shipped("font-family:A;unicode-range:U+??", "font-family:B"))).not.toThrow();
    });
  });
});

/**
 * An ATOMIC rule — one declaration, its own class — which is what composition emits.
 *
 * A whole-block rule carries its nested rules inside it, verbatim, because a block is one class and
 * CSS resolves the nesting. An atomic rule cannot: `&:hover { background: … }` is its own rule with
 * its own class, so the selector has to be written onto that class, and a `@media` around it has to
 * be written around it. This is that emission, and the ORDER it emits in — which is a rule now
 * rather than an accident, because two measurements say the sheet decides what the merge cannot:
 *
 * - a `@media` rule beats a base rule for the same property **only if emitted after it**;
 * - a longhand emitted before a shorthand **loses to it**, whatever the call site said.
 */
describe("an atomic rule", () => {
  const atom = (className: string, css: string, extra: Partial<EmittedBlock> = {}): EmittedBlock => ({
    className,
    css,
    properties: [],
    ...extra,
  });

  test("a plain declaration is a rule on its class", () => {
    const sheet = new Sheet();
    sheet.add("a.tsx", [atom("r-1111111111111111", "display:flex;", { property: "display" })]);

    expect(sheet.css()).toBe(
      `${LAYER_ORDER}\n@layer ramonda {\n@layer ${layerOf(FLEX)} {\n.r-1111111111111111 { display:flex; }\n}\n}\n`,
    );
  });

  test("a nested selector is written onto the class, not inside the rule", () => {
    const sheet = new Sheet();
    sheet.add("a.tsx", [
      atom("r-2222222222222222", "background:red;", { property: "background", selector: "&:hover" }),
    ]);

    expect(sheet.css()).toContain(".r-2222222222222222:hover { background:red; }");
    expect(sheet.css()).not.toContain("&");
  });

  test("a descendant selector keeps its space, because that is what it means", () => {
    const sheet = new Sheet();
    sheet.add("a.tsx", [atom("r-3333333333333333", "color:red;", { property: "color", selector: "& .title" })]);

    expect(sheet.css()).toContain(".r-3333333333333333 .title { color:red; }");
  });

  test("a condition is written around it", () => {
    const sheet = new Sheet();
    sheet.add("a.tsx", [
      atom("r-4444444444444444", "padding:24px;", { property: "padding", conditions: ["@media (min-width: 40rem)"] }),
    ]);

    expect(sheet.css()).toContain("@media (min-width: 40rem) { .r-4444444444444444 { padding:24px; } }");
  });

  test("and several conditions nest, outermost first", () => {
    const sheet = new Sheet();
    sheet.add("a.tsx", [
      atom("r-5555555555555555", "padding:24px;", {
        property: "padding",
        selector: "&:hover",
        conditions: ["@media (min-width: 40rem)", "@supports (display: grid)"],
      }),
    ]);

    expect(sheet.css()).toContain(
      "@media (min-width: 40rem) { @supports (display: grid) { .r-5555555555555555:hover { padding:24px; } } }",
    );
  });

  describe("the order it emits in, which is what the merge cannot decide", () => {
    test("a shorthand is emitted before its longhand, however they arrived", () => {
      const sheet = new Sheet();
      sheet.add("a.tsx", [
        atom("r-6666666666666666", "padding-left:40px;", { property: "padding-left" }),
        atom("r-7777777777777777", "padding:8px;", { property: "padding" }),
      ]);

      const css = sheet.css();
      expect(css.indexOf("padding:8px")).toBeLessThan(css.indexOf("padding-left:40px"));
    });

    test("and a shorthand of shorthands before both", () => {
      const sheet = new Sheet();
      sheet.add("a.tsx", [
        atom("r-1000000000000000", "border-left-width:4px;", { property: "border-left-width" }),
        atom("r-2000000000000000", "border:1px solid red;", { property: "border" }),
        atom("r-3000000000000000", "border-left:2px solid blue;", { property: "border-left" }),
      ]);

      const css = sheet.css();
      expect(css.indexOf("border:1px")).toBeLessThan(css.indexOf("border-left:2px"));
      expect(css.indexOf("border-left:2px")).toBeLessThan(css.indexOf("border-left-width:4px"));
    });

    test("an unconditional rule is emitted before a conditional one, however they arrived", () => {
      const sheet = new Sheet();
      sheet.add("a.tsx", [
        atom("r-8888888888888888", "padding:24px;", { property: "padding", conditions: ["@media (min-width: 40rem)"] }),
        atom("r-9999999999999999", "padding:8px;", { property: "padding" }),
      ]);

      const css = sheet.css();
      expect(css.indexOf("padding:8px")).toBeLessThan(css.indexOf("padding:24px"));
    });

    test("and two rules nothing orders keep the order they arrived in", () => {
      const sheet = new Sheet();
      sheet.add("a.tsx", [
        atom("r-aaaaaaaaaaaaaaa1", "color:red;", { property: "color" }),
        atom("r-aaaaaaaaaaaaaaa2", "display:flex;", { property: "display" }),
      ]);

      const css = sheet.css();
      expect(css.indexOf("color:red")).toBeLessThan(css.indexOf("display:flex"));
    });
  });

  test("the round trip asks for it by its class, like any other rule", () => {
    const sheet = new Sheet();
    sheet.add("a.tsx", [
      atom("r-bbbbbbbbbbbbbbbb", "background:red;", { property: "background", selector: "&:hover" }),
    ]);

    expect(() => sheet.verify(".r-bbbbbbbbbbbbbbbb:hover{background:red}")).not.toThrow();
    expect(() => sheet.verify(".r-cccccccccccccccc:hover{background:red}")).toThrow(CssBlockError);
  });
});

/**
 * The collision assertion sees the whole rule, not its body alone.
 *
 * Two rules with identical CSS and different CONTEXTS are two rules — `.r-x { color: red }` and
 * `.r-x:hover { color: red }` — and comparing bodies could not tell them apart. The class name
 * hashes the context now, so this can only be reached by a real hash collision; it is asserted
 * because an assertion that cannot see the fault it exists for is worth nothing.
 */
describe("two rules under one name that differ only in context", () => {
  const NAME = "r-cccccccccccccccc";

  test("a different selector is a different rule, and fails the build", () => {
    const sheet = new Sheet();
    sheet.add("a.tsx", [{ className: NAME, css: "color:red;", properties: [], property: "color", selector: "" }]);

    expect(() =>
      sheet.add("b.tsx", [
        { className: NAME, css: "color:red;", properties: [], property: "color", selector: "&:hover" },
      ]),
    ).toThrow(CssBlockError);
  });

  test("and so is a different condition", () => {
    const sheet = new Sheet();
    sheet.add("a.tsx", [{ className: NAME, css: "padding:8px;", properties: [], property: "padding" }]);

    expect(() =>
      sheet.add("b.tsx", [
        { className: NAME, css: "padding:8px;", properties: [], property: "padding", conditions: ["@media print"] },
      ]),
    ).toThrow(CssBlockError);
  });

  test("but the same rule twice is still one rule", () => {
    const sheet = new Sheet();
    const rule = { className: NAME, css: "color:red;", properties: [], property: "color", selector: "&:hover" };

    sheet.add("a.tsx", [rule]);
    expect(() => sheet.add("b.tsx", [rule])).not.toThrow();
    expect(sheet.css().match(/r-cccccccccccccccc/g)).toHaveLength(1);
  });
});

/**
 * A readable class name in a SELECTOR, where it has to be escaped.
 *
 * The class attribute takes `r-c-#fff` as it is — an attribute holds anything but whitespace. A
 * selector does not: `#`, `.`, `%`, `(`, `,` and the rest end the class and start something else, so
 * `.r-c-#fff` would parse as the class `r-c` followed by an id. Every one of them takes a `\` in
 * front of it, and both minifiers were measured to keep those.
 *
 * A hashed name is base62 and needs nothing, so the escaping is only ever about the readable half.
 */
describe("a readable class in a selector", () => {
  const rule = (className: string, css: string, extra: Partial<EmittedBlock> = {}): EmittedBlock => ({
    className,
    css,
    properties: [],
    ...extra,
  });

  test("a name with nothing special is written as it is", () => {
    const sheet = new Sheet();
    sheet.add("a.tsx", [rule("r-p-12px", "padding:12px;", { property: "padding" })]);

    expect(sheet.css()).toContain(".r-p-12px { padding:12px; }");
  });

  test.each([
    ["a colour", "r-c-#fff", ".r-c-\\#fff"],
    ["a decimal", "r-o-.5", ".r-o-\\.5"],
    ["a percentage", "r-w-50%", ".r-w-50\\%"],
    ["a function", "r-tf-rotate(45deg)", ".r-tf-rotate\\(45deg\\)"],
    ["a list", "r-m-0,auto", ".r-m-0\\,auto"],
    ["a ratio", "r-ar-16/9", ".r-ar-16\\/9"],
  ])("%s is escaped", (_what, className, selector) => {
    const sheet = new Sheet();
    sheet.add("a.tsx", [rule(className, "x:y;", { property: "x" })]);

    expect(sheet.css()).toContain(`${selector} { x:y; }`);
  });

  test("an underscore and a hyphen are not, because an identifier may hold them", () => {
    const sheet = new Sheet();
    sheet.add("a.tsx", [rule("r-p-4px_0", "padding:4px 0;", { property: "padding" })]);

    expect(sheet.css()).toContain(".r-p-4px_0 {");
    expect(sheet.css()).not.toContain("\\_");
  });

  test("a hashed name is left alone entirely", () => {
    const sheet = new Sheet();
    sheet.add("a.tsx", [rule("r-2Z9Nddmm7", "color:red;", { property: "color" })]);

    expect(sheet.css()).toContain(".r-2Z9Nddmm7 { color:red; }");
    expect(sheet.css()).not.toContain("\\");
  });

  test("and the selector suffix keeps its own punctuation, which is CSS's own", () => {
    const sheet = new Sheet();
    sheet.add("a.tsx", [rule("r-c-#fff", "color:#fff;", { property: "color", selector: "&:hover" })]);

    // The class is escaped; the `:hover` after it is a pseudo-class and must not be.
    expect(sheet.css()).toContain(".r-c-\\#fff:hover { color:#fff; }");
  });
});

/**
 * The round trip has to look for the ESCAPED name, because that is what a stylesheet holds.
 *
 * `verify` asks whether every class the markup names is still in the CSS that came back from
 * post-processing. It looks by substring, and the substring in a stylesheet is escaped — so looking
 * for the raw name would find nothing and fail every build the moment names became readable.
 */
describe("verifying a readable class", () => {
  test("finds it in a stylesheet, where it is escaped", () => {
    const sheet = new Sheet();
    sheet.add("a.tsx", [{ className: "r-c-#fff", css: "color:#fff;", properties: [], property: "color" }]);

    expect(() => sheet.verify(".r-c-\\#fff{color:#fff}")).not.toThrow();
  });

  test("and still refuses when it was renamed away", () => {
    const sheet = new Sheet();
    sheet.add("a.tsx", [{ className: "r-c-#fff", css: "color:#fff;", properties: [], property: "color" }]);

    expect(() => sheet.verify(".a1{color:#fff}")).toThrow(CssBlockError);
  });
});

/**
 * A FILE'S OWN ORDER, which its stylesheet did not have.
 *
 * `cssFor` walked the whole rule map and filtered it to the classes this file names — so the order
 * was the sheet's GLOBAL first-claim order, which is whichever file the bundler happened to
 * transform first. A review found it, and it is measurable end to end.
 *
 * Two files writing the same two conditional declarations in opposite orders: the second one's
 * stylesheet came out in the FIRST one's order, and compiled alone it came out in its own. Both
 * ranks are equal — `sheetRank` separates conditional from unconditional and broad from narrow, not
 * one condition from another — so the stable sort kept an order that belonged to another file, and
 * `override-out-of-order` could not report it because there was nothing about the ranks to report.
 *
 * The declaration that loses is silently the wrong one, and which one it is depends on build order.
 *
 * `byFile` has kept each file's claims in source order since it was written, for a different reason
 * — knowing what to withdraw on a save. It is the order the author wrote, so it is the order to
 * emit, and the rank still sorts within it because that part was never in doubt.
 */
describe("the order one file's stylesheet comes out in", () => {
  /**
   * Two conditions the sheet CANNOT order, which is the case this is about.
   *
   * `min-height` and `hover` are conditions the mode table does not list, so both land in its last
   * slot and rank the same — see `widthSlot`. Two breakpoints, or two modes the table knows, are
   * ordered by it now and would not ask this question at all.
   */
  const CONDITIONS = (first: "height" | "hover") => {
    const h = `  @media (min-height: 40rem) { color: blue; }\n`;
    const p = `  @media (hover: hover) { color: green; }\n`;
    return `const a = <div css=@@(\n${first === "height" ? h + p : p + h})>x</div>;\n`;
  };

  const blocksOf = (code: string, file: string) => transform(code, { filename: file })?.blocks ?? [];
  // The `@media`, not the class name — a class is named after its condition and holds the word too.
  const conditionsIn = (css: string) => [...css.matchAll(/@media \((min-height|hover)/g)].map((found) => found[1]);

  test("its own, whatever another file claimed the same classes first", () => {
    const sheet = new Sheet();
    sheet.add("/a.tsx", blocksOf(CONDITIONS("height"), "/a.tsx"));
    sheet.add("/b.tsx", blocksOf(CONDITIONS("hover"), "/b.tsx"));

    expect(conditionsIn(sheet.cssFor("/a.tsx"))).toEqual(["min-height", "hover"]);
    expect(conditionsIn(sheet.cssFor("/b.tsx"))).toEqual(["hover", "min-height"]);
  });

  test("and the same as it would be compiled alone, which is the point", () => {
    const together = new Sheet();
    together.add("/a.tsx", blocksOf(CONDITIONS("height"), "/a.tsx"));
    together.add("/b.tsx", blocksOf(CONDITIONS("hover"), "/b.tsx"));

    const alone = new Sheet();
    alone.add("/b.tsx", blocksOf(CONDITIONS("hover"), "/b.tsx"));

    expect(together.cssFor("/b.tsx")).toBe(alone.cssFor("/b.tsx"));
  });

  test("in the other build order too, so neither file is the privileged one", () => {
    const sheet = new Sheet();
    sheet.add("/b.tsx", blocksOf(CONDITIONS("hover"), "/b.tsx"));
    sheet.add("/a.tsx", blocksOf(CONDITIONS("height"), "/a.tsx"));

    expect(conditionsIn(sheet.cssFor("/a.tsx"))).toEqual(["min-height", "hover"]);
    expect(conditionsIn(sheet.cssFor("/b.tsx"))).toEqual(["hover", "min-height"]);
  });

  /**
   * **Why emitting in the author's order is safe, and it is not a trade.**
   *
   * Within one file the author's order and the rank cannot disagree, because
   * `override-out-of-order` refuses the block where they would — which is what that rule is FOR.
   * Found by writing the fixture that would have tested the two against each other and watching the
   * compiler refuse it.
   *
   * So the rank is not being overruled here. It orders what the author's order leaves undecided,
   * across files and within one; the change is only about which file's order that is.
   */
  test("a file whose own order contradicts the rank does not compile at all", () => {
    const source =
      `const a = <div css=@@(\n` +
      `  @media (min-width: 40rem) { color: blue; }\n` +
      `  color: red;\n` +
      `)>x</div>;\n`;

    expect(() => blocksOf(source, "/a.tsx")).toThrow(/will not/);
  });

  /** And written the way it compiles, the two agree — which is the same claim from the other side. */
  test("and written the way it compiles, the emitted order is both at once", () => {
    const source =
      `const a = <div css=@@(\n` +
      `  color: red;\n` +
      `  @media (min-width: 40rem) { color: blue; }\n` +
      `)>x</div>;\n`;
    const sheet = new Sheet();
    sheet.add("/a.tsx", blocksOf(source, "/a.tsx"));

    const css = sheet.cssFor("/a.tsx");
    expect(css.indexOf("color: red")).toBeLessThan(css.indexOf("@media"));
  });
});

/**
 * WHERE THE `&` GOES, and it is wherever the author put it.
 *
 * The emitted rule puts the class where the block's `&` stood. That worked for a `&` at the start of
 * a prelude and nowhere else: a review found the rest of the prelude copied through verbatim, so any
 * further `&` reached the stylesheet as an `&` — and in an emitted rule there is no nesting parent,
 * so `&` behaves as `:scope` and resolves against the root element instead of the styled one.
 *
 *     &:hover, &:focus   ->  .r-x:hover, &:focus     the second half hit the ROOT
 *     .parent &          ->  .r-x .parent &          matched nothing the author meant
 *
 * Both were accepted by the checker, so the fault was a wrong stylesheet rather than a refusal.
 *
 * A prelude with no `&` at all is a DESCENDANT, which is CSS nesting's own rule: `div { … }` inside
 * a block styles the `div`s inside the element, not the element.
 */
describe("where the class goes in a nested selector", () => {
  const ruleFor = (css: string) => {
    const source = `const a = <div css=@@(\n${css}\n)>x</div>;\n`;
    const sheet = new Sheet();
    const blocks = transform(source, { filename: "/a.tsx" })?.blocks ?? [];
    sheet.add("/a.tsx", blocks);
    const emitted = sheet.cssFor("/a.tsx");
    const name = blocks[0]?.className ?? "";
    // The class name back out of the rule, so a test reads the SHAPE rather than a hash.
    return emitted.replace(new RegExp(escapeClass(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "CLASS").trim();
  };

  test.each([
    ["a pseudo-class", "  &:hover { color: red; }", ".CLASS:hover { color:red; }"],
    ["a selector LIST, both halves", "  &:hover, &:focus { color: red; }", ".CLASS:hover, .CLASS:focus { color:red; }"],
    [
      "three in a list",
      "  &:hover, &:focus, &:active { color: red; }",
      ".CLASS:hover, .CLASS:focus, .CLASS:active { color:red; }",
    ],
    ["a descendant, written with `&`", "  & .title { color: red; }", ".CLASS .title { color:red; }"],
    ["a descendant, written without one", "  .title { color: red; }", ".CLASS .title { color:red; }"],
    ["a type selector with no `&`", "  div { color: red; }", ".CLASS div { color:red; }"],
    ["an ANCESTOR, where the `&` is last", "  .parent & { color: red; }", ".parent .CLASS { color:red; }"],
    ["an ancestor and a state", "  .parent &:hover { color: red; }", ".parent .CLASS:hover { color:red; }"],
    ["a compound, where `&` binds to the element itself", "  &.open { color: red; }", ".CLASS.open { color:red; }"],
    ["twice in one compound selector", "  & + & { color: red; }", ".CLASS + .CLASS { color:red; }"],
    ["inside `:has()`", "  &:has(> img) { color: red; }", ".CLASS:has(> img) { color:red; }"],
  ])("%s", (_what, css, expected) => {
    expect(ruleFor(css)).toContain(expected);
  });

  /** An `&` inside a quoted attribute value is text, not the parent. */
  test("a `&` inside a string is left alone", () => {
    expect(ruleFor(`  &[data-x="a&b"] { color: red; }`)).toContain(`.CLASS[data-x="a&b"] { color:red; }`);
  });

  /** And a conditional wraps whatever the selector turned out to be. */
  test("a condition still wraps it", () => {
    const rule = ruleFor("  @media print {\n    .parent & { color: red; }\n  }");

    expect(rule).toContain("@media print { .parent .CLASS { color:red; } }");
  });
});

/**
 * A `var()` READING a name nothing in the build sets.
 *
 * The question no single file can answer: a name may be set by a block three components away, so the
 * sheet is what has every file at once. `variable-read-by-another-name` used to guess at it from
 * inside one block — it spoke when a read was a few edits from a name the SAME block set, which made
 * it blind to every real global and loud whenever a project's global name resembled a local one.
 * That is the report the user brought: `--accent` set locally, a global `--ackcent` meant, and the
 * checker naming the wrong one as the fix.
 *
 * Four things make a name known, and the message names all four because which applies is the
 * author's to know: a block sets it, a `@@property` registers it, the config lists it, or the read
 * carries a fallback.
 */
describe("a variable nothing sets", () => {
  const reads = (name: string, fallback = false) => ({
    set: [],
    read: [{ name, at: 0, length: name.length, fallback }],
  });

  test("is refused, and the message says every way to fix it", () => {
    const sheet = new Sheet();
    sheet.add("a.tsx", [], reads("--brand"));

    let message = "";
    try {
      sheet.verifyVariables();
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain("nothing in this build sets `--brand`");
    expect(message).toContain("Set it in a block");
    expect(message).toContain("@@property");
    expect(message).toContain("variables");
    expect(message).toContain("var(--brand, <value>)");
  });

  test("a name another FILE sets is known, which is the whole reason this is asked here", () => {
    const sheet = new Sheet();
    sheet.add("parent.tsx", [], { set: ["--gap"], read: [] });
    sheet.add("child.tsx", [], reads("--gap"));

    expect(() => sheet.verifyVariables()).not.toThrow();
  });

  test("a name the same file sets is known", () => {
    const sheet = new Sheet();
    sheet.add("a.tsx", [], { set: ["--gap"], read: [{ name: "--gap", at: 0, length: 5, fallback: false }] });

    expect(() => sheet.verifyVariables()).not.toThrow();
  });

  test("a fallback is enough on its own", () => {
    const sheet = new Sheet();
    sheet.add("a.tsx", [], reads("--brand", true));

    expect(() => sheet.verifyVariables()).not.toThrow();
  });

  test("and so is the config", () => {
    const sheet = new Sheet();
    sheet.add("a.tsx", [], { ...reads("--brand"), known: ["--brand"] });

    expect(() => sheet.verifyVariables()).not.toThrow();
  });

  /** Per FILE, not a union: a monorepo has one config per package. */
  test("another package's config does not declare it for this one", () => {
    const sheet = new Sheet();
    sheet.add("design/a.tsx", [], { set: [], read: [], known: ["--brand"] });
    sheet.add("app/b.tsx", [], reads("--brand"));

    expect(() => sheet.verifyVariables()).toThrow(/--brand/);
  });

  /** The suggestion now comes from every name in the BUILD, which is what the old rule could not do. */
  test("a near miss in another file is offered as the fix", () => {
    const sheet = new Sheet();
    sheet.add("theme.tsx", [], { set: ["--accent"], read: [] });
    sheet.add("card.tsx", [], reads("--ackcent"));

    expect(() => sheet.verifyVariables()).toThrow(/Did you mean `--accent`/);
  });

  test("with no near miss, the message simply does not offer one", () => {
    const sheet = new Sheet();
    sheet.add("theme.tsx", [], { set: ["--accent"], read: [] });
    sheet.add("card.tsx", [], reads("--totally-different"));

    expect(() => sheet.verifyVariables()).toThrow(/^(?!.*Did you mean)/s);
  });

  test("more than one is counted, so a build does not fix them one at a time blind", () => {
    const sheet = new Sheet();
    sheet.add("a.tsx", [], {
      set: [],
      read: [
        { name: "--one", at: 0, length: 5, fallback: false },
        { name: "--two", at: 9, length: 5, fallback: false },
      ],
    });

    expect(() => sheet.verifyVariables()).toThrow(/1 more like it/);
  });

  /**
   * The other half of "replaced whole", and it was only half true: a file's rules were replaced on
   * every `add` and its variables only when some were handed over — so an adapter telling the sheet
   * that a file has nothing left kept that file's last known names for the life of the process.
   */
  describe("a file that no longer has any", () => {
    test("stops declaring the names it used to set", () => {
      const sheet = new Sheet();
      sheet.add("theme.tsx", [], { set: ["--accent"], read: [] });
      sheet.add("card.tsx", [], reads("--accent"));
      expect(() => sheet.verifyVariables()).not.toThrow();

      // The author deletes theme.tsx's block. Nothing sets `--accent` any more.
      sheet.add("theme.tsx", []);

      expect(() => sheet.verifyVariables()).toThrow(/--accent/);
    });

    test("stops reading the names it used to read", () => {
      const sheet = new Sheet();
      sheet.add("card.tsx", [], reads("--ackcent"));
      expect(() => sheet.verifyVariables()).toThrow(/--ackcent/);

      // The author deletes the typo. Without this the build never came back, whatever they did.
      sheet.add("card.tsx", []);

      expect(() => sheet.verifyVariables()).not.toThrow();
    });
  });

  test("a build that reads none is silent", () => {
    const sheet = new Sheet();
    sheet.add("a.tsx", [], { set: ["--gap"], read: [] });

    expect(() => sheet.verifyVariables()).not.toThrow();
  });
});
