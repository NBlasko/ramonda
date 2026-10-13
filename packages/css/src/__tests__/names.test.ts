import { describe, expect, test } from "vitest";
import type { Block } from "../compiler/ast";
import { HASH_BITS, HASH_LENGTH, classNameFor, substitute, variableNameFor } from "../compiler/names";
import { normalise } from "../compiler/normalise";

/**
 * The names, which are the only thing the two builds have to agree on.
 *
 * A server build and a client build never speak: each hashes its own copy of the source and both
 * write the result into markup that has to match. So the name has to be a pure function of the
 * normalised text and nothing else — no counter, no file path, no order of compilation.
 */

const text = (value: string): Block => ({
  items: [{ kind: "declaration", property: "color", value: [{ kind: "text", text: value }] }],
});

describe("the class name", () => {
  test("is the hash of the normalised block and nothing else", () => {
    expect(classNameFor(normalise(text("red")))).toBe(classNameFor(normalise(text("red"))));
  });

  test("starts with a letter, because a class may not start with a digit", () => {
    expect(classNameFor("display:flex;")).toMatch(/^r-[0-9a-zA-Z]+$/);
  });

  /**
   * **Base62, and the BITS are what is agreed — the width follows from them.**
   *
   * The guarantee is the assembly-time assertion that no two distinct rules share a name; the length
   * only decides whether it ever fires. Bytes were never the reason to be short, and were measured
   * not to be: 8, 12 and 16 hex all gzip to the same 46.7 KB. **Reading is the reason.** A block is
   * one class per DECLARATION now, so an element carries three or four and a complicated one carries
   * twenty-eight — and eighteen characters each is a wall of noise in the markup.
   *
   * A wider alphabet is free — the same bits are 16 hex characters, 13 in base36, 11 in base62 — and
   * the BITS are what the risk is spent on. 48 of them, because **a collision is a failed build and
   * not a wrong page**: the sheet sees every rule in a build at once and stops with both files named.
   * Measured on the real playground, the whole app has 56 atomic rules; at 10,000 the chance is
   * 1.8e-7, one build in five and a half million. 40 bits is where that stops being safe.
   */
  test("is as wide as agreed, and carries what that width holds", () => {
    expect(classNameFor("display:flex;")).toHaveLength("r-".length + HASH_LENGTH);
    expect(HASH_LENGTH).toBe(9);
    expect(HASH_BITS).toBeCloseTo(Math.log2(62 ** HASH_LENGTH), 1);
  });

  /**
   * **Reduced into the width, not truncated to it**, and the difference is visible.
   *
   * Taking 48 bits and writing them in nine base62 characters wastes the first one — 2^48 is 2% of
   * 62^9, so almost every name began with a `0`. Measured on the real playground, every class on the
   * page started with one, which is a character that carries nothing and reads as noise.
   */
  test("every character carries something, including the first", () => {
    const first = new Set<string>();
    for (let index = 0; index < 5_000; index++) first.add(classNameFor(`color:c${index};`)[2]);

    expect(first.size).toBeGreaterThan(50);
  });

  test("and the whole alphabet is reachable, or it is not the width it claims", () => {
    const seen = new Set<string>();
    for (let index = 0; index < 20_000; index++) {
      for (const character of classNameFor(`color:c${index};`).slice(2)) seen.add(character);
    }

    expect(seen.size).toBe(62);
  });

  test("two hundred thousand distinct declarations give two hundred thousand distinct names", () => {
    const seen = new Set<string>();
    for (let index = 0; index < 200_000; index++) seen.add(classNameFor(`color:c${index};`));

    expect(seen.size).toBe(200_000);
  });

  test("two different blocks do not land on the same name", () => {
    expect(classNameFor(normalise(text("red")))).not.toBe(classNameFor(normalise(text("blue"))));
  });
});

describe("the variable name", () => {
  test("is scoped to the block, never positional", () => {
    // Two blocks whose first hole was called `--r0` collide when one is nested inside the other,
    // and the inner element's value wins on the outer element's rule. Silent, and only in the
    // pairing — see DESIGN.md.
    const card = classNameFor("color:red;");
    const title = classNameFor("padding:8px;");
    expect(variableNameFor(card, 0)).not.toBe(variableNameFor(title, 0));
  });

  test("reads as the class it belongs to", () => {
    expect(variableNameFor("r-0123456789abcdef", 2)).toBe("--r-0123456789abcdef-2");
  });
});

describe("putting the names back in", () => {
  test("every hole becomes a var() of its own name", () => {
    const block: Block = {
      items: [
        {
          kind: "declaration",
          property: "border-left",
          value: [
            { kind: "text", text: "4px solid " },
            { kind: "hole", index: 0 },
          ],
        },
      ],
    };
    const canonical = normalise(block);
    const className = classNameFor(canonical);

    expect(substitute(canonical, className)).toBe(`border-left:4px solid var(--${className}-0);`);
  });

  test("the hash is taken BEFORE the names go in, or nothing could be named", () => {
    // The class name is derived from the text, and the variable names are derived from the class —
    // so the text that gets hashed cannot already contain them. The placeholder is what breaks the
    // circle, and this is the test that keeps it broken.
    const canonical = normalise({
      items: [{ kind: "declaration", property: "color", value: [{ kind: "hole", index: 0 }] }],
    });
    expect(canonical).not.toContain("var(");
    expect(substitute(canonical, classNameFor(canonical))).toContain("var(--r-");
  });

  test("a block with no holes comes back unchanged", () => {
    expect(substitute("display:flex;", "r-0123456789abcdef")).toBe("display:flex;");
  });
});
