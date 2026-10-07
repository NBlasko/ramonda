import { describe, expect, test } from "vitest";
import { flatten } from "../compiler/flatten";
import { PROPERTIES } from "../compiler/keywords.generated";
import { keyIn } from "../runtime/key";
import { NAME_BUDGET, keyTextOf, nameFor } from "../compiler/names";
import { readBlock } from "../compiler/read";
import { findBlocks } from "../compiler/scan";
import { transform } from "../compiler/transform";
import type { Config } from "../config/config";
import { kind } from "../config/declared";

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
/** The KEY a name carries — everything between `r-` and the first `-` after it. See `keyToken`. */
const key = (one: string) => keyIn(one);
/** Whether the VALUE fell to the hash, which is the only half that can now. */
const hashedValue = (one: string) => /^[0-9a-zA-Z]{9}$/.test(one.slice(one.indexOf("-", 2) + 1));

describe("a name a person can read", () => {
  test("an abbreviated property is short", () => {
    expect(name("padding: 12px;")).toBe("r-p-12px");
    expect(name("display: flex;")).toBe("r-disp-flex");
    expect(name("align-items: center;")).toBe("r-items-center");
  });

  /**
   * A property with no abbreviation keeps its own name with its `-` written as `_`.
   *
   * The KEY may hold no `-`, because the first one is where the key ends and the value begins — and
   * a value holds `-` all the time (`-4px`, `sans-serif`). A property name in practice holds no `_`,
   * so the swap loses nothing and the name still reads as itself.
   */
  test("and one with no abbreviation uses its own name, with `_` for its dashes", () => {
    expect(name("outline-offset: 4px;")).toBe("r-outline_offset-4px");
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

  test("a custom property keeps its own name and its case, with `_` for its dashes", () => {
    expect(name("--Accent: red;")).toBe("r-__Accent-red");
  });
});

/**
 * **The hash is the FLOOR of the VALUE now, and the key never falls to it whole.**
 *
 * A class carries what its declaration SETS — see `keyToken` — because a merge keeps one class per
 * thing set, and a block that travels as a string has only its classes to say it with. So the key
 * is always there, and only the half after it can be a hash.
 *
 * Measured on this repository when the key was added: 23 of 91 class names (25%) were a bare hash
 * with nothing readable in them, and none are now.
 */
describe("what falls back to the hash", () => {
  /**
   * A context is written where it can be. What cannot: a selector LIST, which names two states
   * sharing a body; anything holding a quote; and anything holding a `-`, which is where the key
   * ends. The PROPERTY still reads in every one of them.
   */
  test.each([
    ["a selector list, which is two selectors rather than one context", "&:hover, &:focus { color: red; }"],
    ["an attribute selector, whose name holds the `-` that ends a key", "&[data-on] { color: red; }"],
    ["a quoted attribute value, which markup would have to escape", `&[data-on="yes"] { color: red; }`],
  ])("%s hashes the CONTEXT and keeps the property", (_what, css) => {
    const one = nameFor(declarationsOf(css)[0]);

    expect(key(one)).toMatch(/^0[0-9a-zA-Z]{5}\.c$/);
    expect(one).toBe(`${`r-${key(one)}`}-red`);
  });

  test("a value longer than the budget", () => {
    const long = "transition: border-left-width .15s ease-in-out, padding-left .15s ease-in-out;";
    // What the readable form WOULD have been, which is the thing over budget — the value becomes
    // the hash, and the key stays, which is the point.
    const readable = `r-tr-${long
      .slice(long.indexOf(":") + 1)
      .trim()
      .replace(/ /g, "_")}`;

    expect(readable.length).toBeGreaterThan(NAME_BUDGET);
    expect(hashedValue(name(long))).toBe(true);
    expect(key(name(long))).toBe("tr");
  });

  test.each([
    ["a quote", 'content: "a b";', "content"],
    ["a space inside a call", "background: url('a b.png');", "bg"],
  ])("and a value holding %s a class name cannot carry", (_what, css, wanted) => {
    expect(hashedValue(name(css))).toBe(true);
    expect(key(name(css))).toBe(wanted);
  });

  test("the budget keeps what the real corpus writes, and cuts the tail", () => {
    // Measured on the playground's own declarations: 29 of 31 are 32 characters or fewer, and the
    // two above it are 61 and 69 — the cliff is where the budget is.
    expect(NAME_BUDGET).toBe(32);
  });
});

describe("what must hold of every name", () => {
  /**
   * A hashed KEY and a written one can never be the same string.
   *
   * A written key starts with the property or with a context, and a context starts with `:`, `.`,
   * `_`, `@` or `[` — a CSS property may not start with a digit, so nothing an author wrote starts
   * with `0`. That is the whole marker, and it costs one character.
   */
  test("a hashed key and a written one can never be the same string", () => {
    expect(key(name("padding: 12px;"))).toBe("p");
    expect(key(name("--a_b: red;")).startsWith("0")).toBe(true);
    expect(key(name("padding: 12px;")).startsWith("0")).toBe(false);
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

  /**
   * **The key is recoverable from the class alone**, which is the whole reason it is in the name.
   *
   * A block travels to another component as a string, and a merge keeps one class per thing SET —
   * so what a class sets has to be readable out of the class itself, whatever the value did.
   */
  test.each([
    ["a plain declaration", "color: red;", "c"],
    ["one with a dashed property", "outline-offset: 4px;", "outline_offset"],
    ["one whose value hashed", 'content: "a b";', "content"],
    ["one in a context", "&:hover { color: red; }", ":hover"],
  ])("%s carries its key, and `keyIn` reads it back", (_what, css, wanted) => {
    const one = nameFor(declarationsOf(css)[0]);

    expect(keyIn(one)).toBe(wanted === ":hover" ? ":hover.c" : wanted);
  });

  test("and two declarations setting the same thing carry the same key, whatever the value", () => {
    expect(keyIn(name("padding: 12px;"))).toBe(keyIn(name('padding: 12px 0 0 "a";')));
    expect(keyIn(name("color: red;"))).not.toBe(keyIn(name("background: red;")));
  });

  test("the key stands for the declaration's context and property, and nothing else", () => {
    const [only] = declarationsOf("&:hover { color: red; }");

    expect(keyTextOf(only)).toBe("&:hover|color");
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

  /**
   * The context and the property are joined by a `.`, not by a `-`.
   *
   * The `-` is where the KEY ends and the value begins, so nothing inside a key may be one. A
   * property can never hold a `.`, which is what makes the join unambiguous, and the name is the
   * same length it always was.
   */
  test("a pseudo-class is written as it is", () => {
    expect(one("&:hover { color: red; }")).toBe("r-:hover.c-red");
    // `:focus-within` holds the `-` that ends a key, so the CONTEXT hashes and `o` still reads.
    expect(one("&:focus-within { opacity: .5; }")).toMatch(/^r-0[0-9a-zA-Z]{5}\.o-\.5$/);
  });

  test("and so is a pseudo-element", () => {
    expect(one("&::after { content: none; }")).toBe("r-::after.content-none");
  });

  test("a compound class keeps its dot, and a descendant is marked with `_`", () => {
    // `&.title` and `& .title` are different selectors and must be different names.
    expect(one("&.title { color: red; }")).toBe("r-.title.c-red");
    expect(one("& .title { color: red; }")).toBe("r-_.title.c-red");
    expect(one("&.title { color: red; }")).not.toBe(one("& .title { color: red; }"));
  });

  test("a conditional at-rule is written literally, with its whitespace collapsed", () => {
    expect(one("@media print { color: red; }")).toBe("r-@media_print.c-red");
    expect(one("@supports (display:grid) { color: red; }")).toBe("r-@supports_(display:grid).c-red");
  });

  test("a condition and a selector compose, outermost first", () => {
    expect(one("@media print { &:hover { color: red; } }")).toBe("r-@media_print:hover.c-red");
  });

  test("and the same declaration in two contexts is two names", () => {
    expect(one("color: red;")).not.toBe(one("&:hover { color: red; }"));
    expect(one("@media print { color: red; }")).not.toBe(one("&:hover { color: red; }"));
  });

  /**
   * **The CONTEXT falls back on its own**, and the property beside it still reads.
   *
   * A hashed context is marked by a leading `0`: a written one always starts with `:`, `.`, `_`,
   * `@` or `[`, and a property cannot start with a digit, so nothing an author wrote can be read as
   * one. The `-` is the third of these and is the one that costs most — `[data-on]` and
   * `@media (min-width: …)` both hold one — and it is what keeps the key's own boundary honest.
   */
  describe("what still falls back", () => {
    test.each([
      ["a selector list, which is two selectors rather than one context", "&:hover, &:focus { color: red; }"],
      ["a context holding a quote, which markup would have to escape", `&[data-on="yes"] { color: red; }`],
      ["a context holding a `-`, which is where a key ends", "&[data-on] { color: red; }"],
      ["a media query, for the same reason", "@media (min-width: 40rem) { color: red; }"],
    ])("%s", (_what, css) => {
      expect(keyIn(one(css))).toMatch(/^0[0-9a-zA-Z]{5}\.c$/);
      expect(one(css)).toMatch(/-red$/);
    });

    test("and two different contexts never share a hashed key", () => {
      expect(keyIn(one("&:hover, &:focus { color: red; }"))).not.toBe(keyIn(one("&[data-on] { color: red; }")));
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
    expect(descendant).toBe("r-@media_print_.title.c-red");
    expect(compound).toBe("r-@media_print.title.c-red");
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
  /** The KEY is what falls back here — the value beside it may still be written. */
  const isHash = (className: string) => /^0[0-9a-zA-Z]{6}$/.test(keyIn(className));

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

  /**
   * And what a property name legitimately holds is still written out, with its `-` as `_`.
   *
   * **An `_` the AUTHOR wrote is the one that cannot be**, and it is the same refusal a context and
   * a value already make. `--a-b` and `--a_b` are two different custom properties and the swap would
   * give them one key — so the key hashes rather than merging two declarations that set different
   * things. Measured here, because a key that is not injective is a style silently dropped.
   */
  test.each([
    ["a plain property", `color: red;`, "r-c-red"],
    ["a custom property", `--brand: red;`, "r-__brand-red"],
    ["a vendor prefix", `-webkit-mask: none;`, "r-_webkit_mask-none"],
    ["a digit", `--2x: red;`, "r-__2x-red"],
  ])("%s is still readable", (_what, css, expected) => {
    expect(name(css)).toBe(expected);
  });

  test("a property holding an `_` falls to the hash, so `--a-b` and `--a_b` stay two keys", () => {
    expect(keyIn(name("--a_b: red;"))).toMatch(/^0[0-9a-zA-Z]{6}$/);
    expect(keyIn(name("--a_b: red;"))).not.toBe(keyIn(name("--a-b: red;")));
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

  /** Every name in the corpus, with the identities that claimed it. */
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
            byName.set(nameFor(one), (byName.get(nameFor(one)) ?? new Set()).add(one.identity));
          }
        }
      }
    }

    return byName;
  };

  test("no two identities claim one name", () => {
    const clashes = [...claimed()]
      .filter(([, identities]) => identities.size > 1)
      .map(([name, identities]) => `${name}: ${[...identities].join("  vs  ")}`);

    expect(clashes).toEqual([]);
  });

  /** And the corpus really does produce names, or the test above asserts nothing. */
  test("and the corpus produces enough of them for the assertion to check", () => {
    expect(claimed().size).toBeGreaterThan(60);
  });

  /**
   * **AND NO TWO DIFFERENT THINGS-SET CLAIM ONE KEY**, which is what step 4 added and is the
   * stronger of the two.
   *
   * A name collision fails the build loudly. A KEY collision does not: two rules setting different
   * things would look to a merge like one thing set twice, and the earlier would be dropped from a
   * page that renders. So the same corpus is asked the same question about the key.
   */
  test("and no two declarations that set different things claim one key", () => {
    const byKey = new Map<string, Set<string>>();

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
            const found = keyIn(nameFor(one));
            byKey.set(found, (byKey.get(found) ?? new Set()).add(keyTextOf(one)));
          }
        }
      }
    }

    const clashes = [...byKey]
      .filter(([, texts]) => texts.size > 1)
      .map(([found, texts]) => `${found}: ${[...texts].join("  vs  ")}`);

    expect(clashes).toEqual([]);
    expect(byKey.size).toBeGreaterThan(20);
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

/**
 * A class name is the same in every project, whatever their configs disagree about.
 *
 * **This is the guarantee packaging rests on**, and it is the user's own reason for asking that
 * there be one naming approach rather than two: people build a component library in one package and
 * consume it BUILT in another. If two projects could name one declaration differently, the consuming
 * side has no way to notice — the CSS is already emitted.
 *
 * `CONTRACT.md` §3 fixes the prefix and `config.ts` refuses `names`, `hash`, `prefix` and `layer` as
 * settings, so the ways to disagree on purpose are closed. This asks the other half: whether a
 * setting a project IS allowed to make can move a name by accident.
 *
 * A config that refuses the declaration outright is skipped rather than counted — a project that
 * will not compile it says nothing about what it would have called it.
 */
describe("what a project's config may not change", () => {
  const CONFIGS: (Config | undefined)[] = [
    undefined,
    { units: { length: ["px"] } },
    { properties: { "<color>": { hardcoded: false } } },
    { tokens: { $color: kind("color", { accent: "#10b981" }) } },
    { properties: { "*": { shorthand: false } } },
    { rules: { "unknown-unit": "off" } },
    { outDir: "somewhere-else" },
  ];

  test.each([["padding-left: 40px"], ["color: white"], ["display: flex"], ["margin: 0 auto"]])(
    "`%s` is one class name across every config",
    (css) => {
      const names = new Set<string>();
      for (const config of CONFIGS) {
        try {
          const out = transform(`const a = <div className={@@( ${css}; )}>x</div>;\n`, {
            filename: "C.tsx",
            config,
          })?.code;
          const found = /"(r-[^"]+)"/.exec(out ?? "")?.[1];
          if (found !== undefined) names.add(found);
        } catch {
          // A config that REFUSES this declaration never names it. Not a disagreement.
        }
      }

      // The control: something was measured, so an empty set cannot pass for free.
      expect(names.size).toBe(1);
    },
  );
});
