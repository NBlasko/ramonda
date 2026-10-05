import { describe, expect, test } from "vitest";
import { CssBlockError } from "../compiler/errors";
import { checkSource } from "../compiler/source";
import { transform } from "../compiler/transform";
import { virtualFile } from "../compiler/virtual";
import { formatText } from "../tooling";

/**
 * Every construct of the block's logic inside every container, two levels deep.
 *
 * The constructs were each tested where they were built, and round 8 found two that compiled into
 * an INTERNAL error only when one sat inside another — a choice inside a match arm. So the pairs are
 * walked rather than picked: each one either compiles or is refused with a sentence, never an
 * internal error; the editor's read survives it; and the formatter keeps what it compiles to and
 * settles. What each refusal SAYS, and what the compiled ones render as, is pinned elsewhere.
 */

const CONSTRUCTS: Record<string, string> = {
  chain: "when $(a) { color: red; } else when $(b) { color: blue; } else { color: gray; }",
  "block match": "match $(t) { x => ( padding: 2px 4px; ); _ => ( padding: 6px; ); }",
  choice: "border: $(a) ? 2px solid red : $(b) ? 1px solid blue : none;",
  "value match": "background: match $(t) { x => red; _ => blue; };",
  spread: "...$(base);",
  declaration: "margin: 4px;",
};

const CONTAINERS: Record<string, (inner: string) => string> = {
  "the top": (inner) => inner,
  "a hover": (inner) => `&:hover { ${inner} }`,
  "a media query": (inner) => `@media (min-width: 1px) { ${inner} }`,
  "a child selector": (inner) => `& .child { ${inner} }`,
  "a when": (inner) => `when $(g) { ${inner} }`,
  "an else": (inner) => `when $(g) { color: black; } else { ${inner} }`,
  "a match arm": (inner) => `match $(t) { x => ( ${inner} ); _ => ( color: white; ); }`,
};

const HEAD =
  'declare const a: boolean;\ndeclare const b: boolean;\ndeclare const g: boolean;\ndeclare const t: "x" | "y";\n' +
  "const base = @@( padding: 8px; );\nexport const out = (k: number) => @@(\n  ";
const TAIL = "\n);\n";

/** What a source compiles to, or the kind of refusal it got. */
const compiled = (source: string): string => {
  try {
    const result = transform(source, { filename: "A.tsx" });
    return JSON.stringify([result?.blocks.map((one) => one.css).sort(), result?.code.replace(/\s+/g, "")]);
  } catch (error) {
    return error instanceof CssBlockError ? "refused" : `INTERNAL ${String(error).slice(0, 120)}`;
  }
};

describe("two levels of nesting", () => {
  test.each(Object.entries(CONSTRUCTS))("%s, inside every pair of containers", (_name, construct) => {
    const faults: string[] = [];
    for (const [outerName, outer] of Object.entries(CONTAINERS)) {
      for (const [innerName, inner] of Object.entries(CONTAINERS)) {
        const where = `${outerName} > ${innerName}`;
        const source = `${HEAD}${outer(inner(construct))}${TAIL}`;
        const before = compiled(source);
        if (before.startsWith("INTERNAL")) faults.push(`${where}: ${before}`);
        try {
          virtualFile(source, { properties: "./properties", tolerant: true });
          checkSource(source, "/A.tsx", { tolerant: true });
        } catch (error) {
          faults.push(`${where}: the editor's read threw ${String(error).slice(0, 80)}`);
        }
        if (before === "refused" || before.startsWith("INTERNAL")) continue;
        const once = formatText(source, "A.tsx", (text) => text);
        if (compiled(once) !== before) faults.push(`${where}: formatting changed what it compiles to`);
        if (formatText(once, "A.tsx", (text) => text) !== once) faults.push(`${where}: formatting did not settle`);
      }
    }

    expect(faults).toEqual([]);
  });
});
