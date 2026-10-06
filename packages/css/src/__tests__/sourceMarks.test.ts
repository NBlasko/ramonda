import { describe, expect, test } from "vitest";
import { transform } from "../compiler/transform";
import { mergeClassNames } from "../runtime/merge";
import { withoutSourceMarks } from "../runtime/sources";

/**
 * SOURCE MARKS — DESIGN.md §19. On the dev server each block's classes carry one more,
 * `r:src:<path>:<line>`, so the browser's Elements panel shows which blocks gave an element its
 * classes. A spread leaves no mark; blocks merged side by side keep all of theirs.
 */

const SOURCE = `import { base } from "./base";
export const card = @@( padding: 8px; );
export const wide = @@( ...$(base); padding-left: 40px; );
export const loud = (on: boolean) => @@( color: red; when $(on) { color: blue; } );
`;

const compiled = (marks?: string) => transform(SOURCE, { filename: "/p/src/Card.tsx", marks })?.code ?? "";

describe("what the compiler writes", () => {
  test("nothing, unless it is asked to — a build and a test run have no marks", () => {
    expect(compiled()).not.toContain("r:src:");
    expect(compiled()).not.toContain("withoutSourceMarks");
  });

  test("each block names the line its `@@` is on", () => {
    const code = compiled("src/Card.tsx");

    expect(code).toContain(`"r:src:src/Card.tsx:2"`);
    expect(code).toContain(`"r:src:src/Card.tsx:3"`);
    // After a guard too: the mark is the block's, not the group's.
    expect(code).toContain(`on && "r-c-blue","r:src:src/Card.tsx:4"`);
  });

  test("a spread's base loses its marks, so the block that spreads it names itself", () => {
    const code = compiled("src/Card.tsx");

    expect(code).toContain(`_merge(_unsrc(base),"r-pl-40px","r:src:src/Card.tsx:3")`);
    expect(code).toContain("withoutSourceMarks as _unsrc");
  });

  test("a block that is only a spread still names itself", () => {
    const code = transform(`import { base } from "./base";\nexport const a = @@( ...$(base); );\n`, {
      filename: "/p/src/A.tsx",
      marks: "src/A.tsx",
    })?.code;

    expect(code).toContain(`_merge(_unsrc(base),"r:src:src/A.tsx:2")`);
  });

  test("a path with a space stays one class", () => {
    const code = transform(`export const a = @@( color: red; );\n`, {
      filename: "/p/My App/A.tsx",
      marks: "My App/A.tsx",
    })?.code;

    expect(code).toContain(`"r:src:My%20App/A.tsx:1"`);
  });
});

describe("what the merge does with them", () => {
  const base = "r-p- r-pt-8px r-pr-8px r-pb-8px r-pl-8px r:src:src/base.ts:1";

  test("a spread keeps only the mark of the block that spreads", () => {
    const card = mergeClassNames(withoutSourceMarks(base), "r-pl-40px", "r:src:src/Card.tsx:3");

    expect(card.split(" ").filter((one) => one.startsWith("r:src:"))).toEqual(["r:src:src/Card.tsx:3"]);
  });

  test("blocks merged side by side keep both, since both were used", () => {
    const card = mergeClassNames("r-c-red", "r:src:src/Card.tsx:10");
    const sent = mergeClassNames("r-c-blue", "r:src:src/Page.tsx:22");

    expect(mergeClassNames(card, sent).split(" ")).toEqual([
      "r:src:src/Card.tsx:10",
      "r-c-blue",
      "r:src:src/Page.tsx:22",
    ]);
  });

  test("they change nothing the classes decide", () => {
    const strip = (classes: string) => withoutSourceMarks(classes);
    const marked = mergeClassNames(
      mergeClassNames("r-p- r-pt-8px r-pr-8px r-pb-8px r-pl-8px", "r:src:a.ts:1"),
      mergeClassNames("r-pl-40px r-c-red", "r:src:b.ts:2"),
    );
    const plain = mergeClassNames("r-p- r-pt-8px r-pr-8px r-pb-8px r-pl-8px", "r-pl-40px r-c-red");

    expect(strip(marked)).toBe(plain);
  });

  test("the same mark twice is one", () => {
    expect(mergeClassNames("r-c-red r:src:a.ts:1", "r:src:a.ts:1").split(" ")).toEqual(["r-c-red", "r:src:a.ts:1"]);
  });
});

describe("withoutSourceMarks", () => {
  test("drops the marks and nothing else", () => {
    expect(withoutSourceMarks("lead r-c-red r:src:a.ts:1 r-gap-4px")).toBe("lead r-c-red r-gap-4px");
  });

  /**
   * A spread's operand is often an optional prop — `...$(props.css)` — and the merge takes `undefined`,
   * `null` and `false` for a part that is not there. Found on the playground's dev server: the
   * first version read `.includes` off `undefined` and the page threw.
   */
  test.each([undefined, null, false] as const)("hands back %s as it is, as the merge takes it", (absent) => {
    expect(withoutSourceMarks(absent)).toBe(absent);
  });

  test("hands back a string with no mark as it is", () => {
    const classes = "r-c-red r-gap-4px";

    expect(withoutSourceMarks(classes)).toBe(classes);
  });
});
