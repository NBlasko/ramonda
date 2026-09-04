import { describe, expect, test } from "vitest";
import type { Block } from "../compiler/ast";
import { HASH_LENGTH, classNameFor, substitute, variableNameFor } from "../compiler/names";
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
    expect(classNameFor("display:flex;")).toMatch(/^r-[0-9a-f]+$/);
  });

  test("carries the agreed number of hex characters", () => {
    // 16 is not a guess: the guarantee is the assembly-time assertion that no two distinct blocks
    // share a name, and the length only decides whether that assertion ever fires. Measured, the
    // extra characters gzip to nothing — see DESIGN.md.
    expect(classNameFor("display:flex;")).toHaveLength("r-".length + HASH_LENGTH);
    expect(HASH_LENGTH).toBe(16);
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
