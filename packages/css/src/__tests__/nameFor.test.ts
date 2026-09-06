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
    expect(hashed(name("color: {{accent}};"))).toBe(true);
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
    expect(hashed(name("color: {{accent}};"))).toBe(true);
    expect(name("color: {{accent}};").slice(2)).not.toContain("-");
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
    const [only] = declarationsOf("color: {{accent}};");

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
