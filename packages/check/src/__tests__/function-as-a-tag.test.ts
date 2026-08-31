import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const at = join(here, "fixtures", "function-as-a-tag");
const found = () => analyzeProject(join(at, "tsconfig.json")).findings["function-used-as-a-tag"];

const lineOf = (label: string) => {
  const source = readFileSync(join(at, "app.tsx"), "utf8").split("\n");
  const line = source.findIndex((one) => one.includes(label));
  if (line < 0) throw new Error(`no line in the fixture holds ${label}`);
  return line + 1;
};

/**
 * A plain function written in tag position.
 *
 * The reason this is a rule and not left to the compiler is measured rather than assumed:
 * `JSX.ElementType` is deliberately undeclared, so TypeScript's default rule applies — a tag must
 * return one `JSX.Element` — and of the three shapes it refuses two. The one it accepts is a
 * function returning exactly ONE element, which is how a function component gets written by habit.
 */
describe("a function where a component belongs", () => {
  test("a declaration, an arrow and an import are all reported", () => {
    expect(found().map((issue) => issue.tag)).toEqual(["SideBar", "Footer", "Many", "Imported"]);
  });

  /**
   * The report says whether the compiler ALSO refuses it, because a reader meeting two messages
   * about one line should know why there are two rather than wonder which is wrong.
   */
  test("it says which ones the types already refuse", () => {
    const byTag = new Map(found().map((issue) => [issue.tag, issue.alsoRefusedByTypes]));

    // Several nodes back is `TS2786`; one node back is the shape the types let through.
    expect(byTag.get("Many")).toBe(true);
    expect(byTag.get("SideBar")).toBe(false);
    expect(byTag.get("Footer")).toBe(false);
  });

  /**
   * And a THIRD state, found by running against a fixture that already existed.
   *
   * `element-components` holds `(props) => props.value` used as a tag. It returns a string, so the
   * compiler DOES refuse it — and reading only literals called that "one node" and printed *the
   * types let this shape through*, which is the opposite of true. A name does not say what it
   * returns, so the answer is `undefined` and the report says nothing about the compiler rather
   * than guessing which way.
   */
  test("a return this cannot read leaves the compiler question unanswered", () => {
    const others = analyzeProject(join(here, "fixtures", "element-components", "tsconfig.json")).findings[
      "function-used-as-a-tag"
    ];

    expect(others.map((issue) => `${issue.tag}=${String(issue.alsoRefusedByTypes)}`)).toEqual(["TextArea2=undefined"]);
  });

  /**
   * The silences. A class is a component, which is the point; an alias for one is still one; a
   * value read off something is not knowable from here — the router's kit is exactly that shape;
   * and a call in an expression slot is the ANSWER this rule recommends, not the fault.
   */
  test("a class, an alias, a property access, an expression call and a plain tag are silent", () => {
    const lines = found().map((issue) => issue.line);

    for (const label of ["<Card />", "<Aliased />", "<kit.Link />", "{SideBar()}", "<p>text</p>"]) {
      expect(lines, label).not.toContain(lineOf(label));
    }
    expect(lines).toHaveLength(4);
  });
});
