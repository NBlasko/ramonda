import { describe, expect, test } from "vitest";
import type { EmittedBlock } from "../compiler/transform";
import { CssBlockError } from "../compiler/errors";
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

    expect(sheet.css()).toBe(`@layer ramonda {\n.r-1111111111111111 { display:flex; }\n}\n`);
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

describe("the layer", () => {
  /**
   * One named layer, beneath everything unlayered — which is every hand-written stylesheet. So an
   * author's own `.card { display: block }` wins over a generated rule whatever the order of the
   * files, and they never have to reason about specificity against generated output.
   */
  test("every rule sits in it", () => {
    const sheet = new Sheet();
    sheet.add("a.tsx", [FLEX, GRID]);

    const css = sheet.css();
    expect(css.startsWith("@layer ramonda {\n")).toBe(true);
    expect(css.endsWith("}\n")).toBe(true);
    expect(css.match(/@layer/g)).toHaveLength(1);
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

    expect(sheet.css()).toBe(`@layer ramonda {\n@keyframes r-4444444444444444 { from{opacity:0;}to{opacity:1;} }\n}\n`);
  });

  test("and one whose at-rule takes no name carries none", () => {
    const sheet = new Sheet();
    sheet.add("a.tsx", [FACE]);

    expect(sheet.css()).toContain("@font-face { src:url(a.woff2); }");
    expect(sheet.css()).not.toContain("r-5555555555555555");
  });

  test("travels with the file that owns it, like any other rule", () => {
    const sheet = new Sheet();
    sheet.add("a.tsx", [SLIDE]);
    sheet.add("b.tsx", [SLIDE]);

    expect(sheet.cssFor("a.tsx")).toContain("@keyframes r-4444444444444444");
    expect(sheet.cssFor("b.tsx")).toBe("");
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
});
