import { describe, expect, test } from "vitest";
import { flatten } from "../compiler/flatten";
import { PROPERTIES } from "../compiler/keywords.generated";
import { NAME_BUDGET, classNameFor, nameFor } from "../compiler/names";
import { readBlock } from "../compiler/read";
import { findBlocks } from "../compiler/scan";

/**
 * A class name a person can read, and the hash underneath it.
 *
 * The first objection to this whole design was the hash, and it was never about bytes: `r-6EGL6aW4l`
 * tells a reader nothing, and a block is one class per DECLARATION now, so an element carries three
 * or four and a complicated one carries twenty-eight.
 *
 * **The hash is the FLOOR, not the default.** A name is readable when it can be written without
 * losing anything, and hashed when it cannot — so a form this does not yet cover is always correct,
 * merely less pretty. That is what lets the readable half grow one context at a time.
 *
 * **Readable and hashed names can never collide, structurally.** A hash is base62, which has no `-`,
 * so a hashed name holds no `-` after the prefix; a readable one always does, because the `-` is
 * what separates the property from the value. There is nothing to check at runtime.
 */
const declarationsOf = (css: string) => {
  const source = `const x = @@(\n${css}\n);`;
  const [site] = findBlocks(source);
  return flatten(readBlock(source, site.open, "", { tolerant: true }).block);
};

const name = (css: string) => nameFor(declarationsOf(css)[0]);
const hashed = (one: string) => /^r-[0-9a-zA-Z]{9}$/.test(one);

describe("a name a person can read", () => {
  test("an abbreviated property is short", () => {
    expect(name("padding: 12px;")).toBe("r-p-12px");
    expect(name("display: flex;")).toBe("r-disp-flex");
    expect(name("align-items: center;")).toBe("r-items-center");
  });

  test("and one with no abbreviation uses its own name, which already reads", () => {
    expect(name("outline-offset: 4px;")).toBe("r-outline-offset-4px");
    expect(name("isolation: isolate;")).toBe("r-isolation-isolate");
  });

  test("a space in the value becomes `_`, because a class name may not hold one", () => {
    expect(name("padding: 4px 0;")).toBe("r-p-4px_0");
    expect(name("margin: 0 auto;")).toBe("r-m-0_auto");
  });

  test("the value is written VERBATIM, which is what makes it lossless", () => {
    // Stripping was measured to be lossy: `.5` and `5` are both valid and would strip to one name.
    expect(name("opacity: .5;")).toBe("r-o-.5");
    expect(name("opacity: 5;")).toBe("r-o-5");
    expect(name("opacity: .5;")).not.toBe(name("opacity: 5;"));
  });

  test("a custom property keeps its own name and its case", () => {
    expect(name("--Accent: red;")).toBe("r---Accent-red");
  });
});

describe("what falls back to the hash", () => {
  test("a declaration carrying a hole, because its value is not text", () => {
    expect(hashed(name("color: {accent};"))).toBe(true);
  });

  /**
   * A context is written now — see *context in a readable name* below. What is left here is the
   * shape that cannot be one thing: a selector LIST names two states sharing a body.
   */
  test("a selector list, which is two selectors rather than one context", () => {
    expect(hashed(nameFor(declarationsOf("&:hover, &:focus { color: red; }")[0]))).toBe(true);
  });

  test("a value longer than the budget", () => {
    const long = "transition: border-left-width .15s ease-in-out, padding-left .15s ease-in-out;";
    // What the readable form WOULD have been, which is the thing over budget — the name itself is
    // the hash, and that is the point.
    const readable = `r-tr-${long
      .slice(long.indexOf(":") + 1)
      .trim()
      .replace(/ /g, "_")}`;

    expect(readable.length).toBeGreaterThan(NAME_BUDGET);
    expect(hashed(name(long))).toBe(true);
  });

  test("and a value holding a character a class name cannot carry", () => {
    expect(hashed(name('content: "a b";'))).toBe(true);
    expect(hashed(name("background: url('a b.png');"))).toBe(true);
  });

  test("the budget keeps what the real corpus writes, and cuts the tail", () => {
    // Measured on the playground's own declarations: 29 of 31 are 32 characters or fewer, and the
    // two above it are 61 and 69 — the cliff is where the budget is.
    expect(NAME_BUDGET).toBe(32);
  });
});

describe("what must hold of every name", () => {
  test("a hashed name and a readable one can never be the same string", () => {
    // A hash is base62 and holds no `-`; a readable name always holds the one before its value.
    expect(name("padding: 12px;")).toContain("-");
    expect(hashed(name("color: {accent};"))).toBe(true);
    expect(name("color: {accent};").slice(2)).not.toContain("-");
  });

  test("the same declaration is the same name, or dedupe stops working", () => {
    expect(name("padding: 12px;")).toBe(name("padding:12px"));
  });

  test("every property CSS has produces a name of its own", () => {
    const seen = new Map<string, string>();
    for (const property of PROPERTIES) {
      const one = name(`${property}: 1px;`);
      expect(seen.get(one), `${property} and ${seen.get(one)} share ${one}`).toBeUndefined();
      seen.set(one, property);
    }

    expect(seen.size).toBe(PROPERTIES.length);
  });

  test("and two values of one property never share a name", () => {
    const seen = new Set<string>();
    for (let index = 0; index < 2_000; index++) seen.add(name(`padding: ${index}px;`));

    expect(seen.size).toBe(2_000);
  });

  test("the hash is still the hash where it is used", () => {
    const [only] = declarationsOf("color: {accent};");

    expect(nameFor(only)).toBe(classNameFor(only.identity));
  });
});

/**
 * Context in the name, written LITERALLY — decided with the user, against a scale.
 *
 * A short name from a design scale — `md-` for `@media (min-width: 40rem)` — is exactly the magic
 * the hash was being replaced for, and there is no scale here to be short against. So the context is
 * written as the author wrote it, with whitespace collapsed.
 *
 * **Every context form starts with a character an abbreviation cannot**, which is what keeps the
 * name injective: `:` for a pseudo-class, `.` for a class, `_` for a descendant, `@` for a
 * conditional at-rule, `[` for an attribute. An abbreviation is letters and a property name is
 * letters and hyphens, so no context can be mistaken for one.
 *
 * Ordered by what each recovers, measured on the demo file: a pseudo-class 8 declarations, a
 * descendant 4, an at-rule 4, an attribute 2.
 */
describe("context in a readable name", () => {
  const one = (css: string) => nameFor(declarationsOf(css)[0]);

  test("a pseudo-class is written as it is", () => {
    expect(one("&:hover { color: red; }")).toBe("r-:hover-c-red");
    expect(one("&:focus-within { opacity: .5; }")).toBe("r-:focus-within-o-.5");
  });

  test("and so is a pseudo-element", () => {
    expect(one("&::after { content: none; }")).toBe("r-::after-content-none");
  });

  test("a compound class keeps its dot, and a descendant is marked with `_`", () => {
    // `&.title` and `& .title` are different selectors and must be different names.
    expect(one("&.title { color: red; }")).toBe("r-.title-c-red");
    expect(one("& .title { color: red; }")).toBe("r-_.title-c-red");
    expect(one("&.title { color: red; }")).not.toBe(one("& .title { color: red; }"));
  });

  test("a conditional at-rule is written literally, with its whitespace collapsed", () => {
    expect(one("@media print { color: red; }")).toBe("r-@media_print-c-red");
    expect(one("@supports (display:grid) { color: red; }")).toBe("r-@supports_(display:grid)-c-red");
  });

  test("an attribute selector too", () => {
    expect(one("&[data-on] { color: red; }")).toBe("r-[data-on]-c-red");
  });

  test("a condition and a selector compose, outermost first", () => {
    expect(one("@media print { &:hover { color: red; } }")).toBe("r-@media_print:hover-c-red");
  });

  test("and the same declaration in two contexts is two names", () => {
    expect(one("color: red;")).not.toBe(one("&:hover { color: red; }"));
    expect(one("@media print { color: red; }")).not.toBe(one("&:hover { color: red; }"));
  });

  describe("what still falls back", () => {
    test("a selector list, which is two selectors rather than one context", () => {
      expect(hashed(one("&:hover, &:focus { color: red; }"))).toBe(true);
    });

    test("a context holding a quote, which markup would have to escape", () => {
      expect(hashed(one('&[data-on="yes"] { color: red; }'))).toBe(true);
    });

    test("and a context that pushes the name over the budget", () => {
      const long = "@media (min-width: 40rem) and (orientation: landscape) { padding: 24px; }";

      expect(hashed(one(long))).toBe(true);
    });
  });
});

/**
 * The collision a naive join would have made, asserted so it cannot come back.
 *
 * A selector carries its own leading space when it is a DESCENDANT, and that space is the whole
 * difference between `& .title` and `&.title`. Joining the conditions to the selector with a space
 * added one to the compound form too — so `@media print` with `.title` and `@media print` with
 * ` .title` became one name, which is two different rules under one class.
 */
describe("a descendant under a condition", () => {
  const one = (css: string) => nameFor(declarationsOf(css)[0]);

  test("is not the same name as a compound one", () => {
    const descendant = one("@media print { & .title { color: red; } }");
    const compound = one("@media print { &.title { color: red; } }");

    expect(descendant).not.toBe(compound);
    expect(descendant).toBe("r-@media_print_.title-c-red");
    expect(compound).toBe("r-@media_print.title-c-red");
  });
});

/**
 * A PROPERTY NAME that cannot be written into a class name.
 *
 * The value is gated by `SAFE_VALUE` and the context by `SAFE_CONTEXT`; the property was
 * interpolated unchecked. A review found what that costs, and it is not cosmetic.
 *
 * `readHead` keeps a name's interior whitespace, and nothing refused it, so `--brand` wrapped across
 * two lines — a plausible accident, and what a missing `;` looks like — produced the class
 * `r---brand\n  -color-red`. Emitted as a selector that is `\` followed by a newline, which is **not
 * a valid escape**: css-tree, lightningcss and jsdom all refuse it, so a browser drops the rule and a
 * lightningcss step in the pipeline throws on the whole stylesheet. A space or a tab is milder and
 * still broken: the selector names one class containing whitespace, while the markup's `class`
 * attribute tokenises into two, so the rule can never match anything.
 *
 * The hash answers for it, which is what the hash is for — see `nameFor`: it is the FLOOR, and a
 * form not yet covered is always correct and merely less pretty.
 */
describe("a property name that cannot be written", () => {
  const isHash = (className: string) => /^r-[0-9a-zA-Z]+$/.test(className);

  test.each([
    ["a space", `--a b: red;`],
    ["a tab", "--a\tb: red;"],
    ["a newline, which makes an invalid escape", "--brand\n  -color: red;"],
    ["a carriage return", "--a\rb: red;"],
    ["a form feed", "--a\fb: red;"],
    ["a non-breaking space, which no ident may hold either", "--a\u00a0b: red;"],
    ["a two-word typo", `font size: 12px;`],
  ])("%s falls to the hash", (_what, css) => {
    expect(isHash(name(css))).toBe(true);
  });

  /** And what a property name legitimately holds is still written out. */
  test.each([
    ["a plain property", `color: red;`, "r-c-red"],
    ["a custom property", `--brand: red;`, "r---brand-red"],
    ["a vendor prefix", `-webkit-mask: none;`, "r--webkit-mask-none"],
    ["an underscore", `--a_b: red;`, "r---a_b-red"],
    ["a digit", `--2x: red;`, "r---2x-red"],
  ])("%s is still readable", (_what, css, expected) => {
    expect(name(css)).toBe(expected);
  });
});

/**
 * A READABLE NAME IS INJECTIVE, which is the claim the whole readable half rests on.
 *
 * `nameFor`'s own note says two readable names differ whenever their declarations do. A review found
 * that false, and this is the assertion that would have caught it — asked of the pair rather than of
 * one name, because that is the only shape the fault has.
 *
 * **The encoding is why.** A space becomes `_`, and `_` is a character CSS already allows, so the
 * two are indistinguishable afterwards:
 *
 *     & .a b   and  & .a_b     two selectors, one name
 *     My Font  and  My_Font    two font families, one name
 *
 * No escaping fixes it while `_` means both things, so a text that already holds one falls to the
 * hash — which is what the hash is for. Three root causes were found this way. Two were the encoding
 * above, in the context and again in the VALUE; the third was a leading space being stripped, so
 * `& div` and `&div` — a descendant and a compound — came out the same.
 *
 * A hashed name is injective by construction, so only readable ones are compared. The corpus is
 * deliberately full of near misses rather than large.
 */
describe("a readable name is injective over identities", () => {
  const PRELUDES = [
    "&:hover",
    "&.open",
    "& .title",
    ".title",
    "& .a b",
    "& .a_b",
    "&div",
    "& div",
    "&::before",
    "& > .a",
    "&+&",
    ".parent &",
    "&:has(> img)",
    '&[data-x="a b"]',
    "& .a  b",
    "& _b",
    "&_b",
    "& .a-b",
  ];
  const CONDITIONS = ["", "@media print", "@media (min-width: 40rem)", "@supports (display:grid)"];
  const DECLARATIONS = [
    "color: red;",
    "padding: 8px;",
    "--a_b: 1;",
    "grid-area: a_b;",
    "grid-area: a b;",
    'content: "a b";',
    'content: "a  b";',
    "font-family: My_Font;",
    "font-family: My Font;",
  ];

  /** Every readable name in the corpus, with the identities that claimed it. */
  const claimed = () => {
    const byName = new Map<string, Set<string>>();

    for (const prelude of PRELUDES) {
      for (const condition of CONDITIONS) {
        for (const declaration of DECLARATIONS) {
          const inner = `${prelude} { ${declaration} }`;
          const css = condition === "" ? inner : `${condition} { ${inner} }`;
          let atoms: ReturnType<typeof flatten>;
          try {
            atoms = declarationsOf(css);
          } catch {
            continue;
          }
          for (const one of atoms) {
            const name = nameFor(one);
            if (hashed(name)) continue;
            byName.set(name, (byName.get(name) ?? new Set()).add(one.identity));
          }
        }
      }
    }

    return byName;
  };

  test("no two identities claim one readable name", () => {
    const clashes = [...claimed()]
      .filter(([, identities]) => identities.size > 1)
      .map(([name, identities]) => `${name}: ${[...identities].join("  vs  ")}`);

    expect(clashes).toEqual([]);
  });

  /** And the corpus really does produce readable names, or the test above asserts nothing. */
  test("and the corpus is mostly readable, so the assertion has something to check", () => {
    const names = claimed();

    // 73 today. The number is a floor rather than a fact: it says the corpus is mostly readable, so
    // the assertion above has something to check, and it moves whenever the name budget does.
    expect(names.size).toBeGreaterThan(60);
  });

  /** The three shapes that used to collide, named so a regression says which one came back. */
  test.each([
    ["a space against an underscore, in a selector", "& .a b { color: red; }", "& .a_b { color: red; }"],
    [
      "a space against an underscore, in a value",
      "&:hover { font-family: My Font; }",
      "&:hover { font-family: My_Font; }",
    ],
    ["a descendant against a compound", "& div { color: red; }", "&div { color: red; }"],
  ])("%s", (_what, one, other) => {
    const [a] = declarationsOf(one);
    const [b] = declarationsOf(other);

    expect(a.identity).not.toBe(b.identity);
    expect(nameFor(a)).not.toBe(nameFor(b));
  });
});
