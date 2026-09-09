import { describe, expect, test } from "vitest";
import { readBlock } from "../compiler/read";
import { findBlocks } from "../compiler/scan";
import { checkSource, checkedSource } from "../compiler/source";
import { variablesIn } from "../compiler/variables";

/**
 * What a block does with custom properties, which is the input to the only check that can answer
 * "does this name exist" — see `Sheet.verifyVariables`.
 *
 * One function, read by the rule that suggests a near miss and by the transform that hands the
 * names to the stylesheet. Two scanners would be two answers to one question, which is the fault
 * this package keeps finding.
 */
const of = (css: string) => {
  const source = `<div css=@@(\n${css}\n)>x</div>`;
  const [site] = findBlocks(source);
  return variablesIn(readBlock(source, site.open, "C.tsx", { tolerant: true }).block);
};

const names = (css: string) => of(css).read.map((one) => `${one.name}${one.fallback ? "+fallback" : ""}`);

describe("the names a block reads", () => {
  test.each([
    ["a bare read", "  color: var(--a);", ["--a"]],
    ["a fallback", "  color: var(--a, red);", ["--a+fallback"]],
    ["a fallback with no space", "  color: var(--a,red);", ["--a+fallback"]],
    ["spaces around the name", "  color: var( --a , red );", ["--a+fallback"]],
    // A fallback holds a value, so it holds `var()` too — each name is asked about its OWN fallback,
    // and the innermost one is what has to exist.
    ["a nested read with none of its own", "  color: var(--a, var(--b));", ["--a+fallback", "--b"]],
    ["a nested read with one", "  color: var(--a, var(--b, red));", ["--a+fallback", "--b+fallback"]],
    ["two reads in one value", "  border: var(--a) var(--b, 1px);", ["--a", "--b+fallback"]],
    ["upper case, because CSS function names fold", "  color: VAR(--a);", ["--a"]],
  ])("%s", (_what, css, expected) => {
    expect(names(css)).toEqual(expected);
  });

  test.each([
    ["inside a string, which is a quotation", '  content: "var(--a)";'],
    ["not a custom property, which is not valid CSS", "  color: var(brand);"],
  ])("%s is not a read", (_what, css) => {
    expect(names(css)).toEqual([]);
  });
});

describe("the names a block sets", () => {
  test("a declaration at the top", () => {
    expect(of("  --a: 1px;").set).toEqual(["--a"]);
  });

  /**
   * A block's custom properties land on ONE element, so nesting does not divide them: set inside
   * `&:hover` and read at the top is the same variable either way.
   */
  test("and one inside a nested rule, which is the same element", () => {
    expect(of("  &:hover { --a: 1px; }\n  color: var(--a);").set).toEqual(["--a"]);
  });

  test("an ordinary property is not one", () => {
    expect(of("  color: red;").set).toEqual([]);
  });
});

/**
 * `checkSource` is the sequence a consumer OUTSIDE this package runs — the documentation gate calls
 * it for every example in `apps/docs/content`. It is `checkedSource` without the variables, and the
 * two must not drift: the gate reporting different findings from `ramonda-css check` is a doc that
 * can be wrong and pass.
 */
describe("the two ways one walk is asked for", () => {
  const source = `const a = <div css=@@(\n  dsiplay: flex;\n)>x</div>;\n`;

  test("`checkSource` is `checkedSource` without the variables", () => {
    expect(checkSource(source, "C.tsx")).toEqual(checkedSource(source, "C.tsx").findings);
  });

  test("and the variables come from the same walk, not a second parse", () => {
    const walked = checkedSource(`const a = <div css=@@(\n  --a: 1px;\n  color: var(--b);\n)>x</div>;\n`, "C.tsx");

    expect(walked.variables.set).toEqual(["--a"]);
    expect(walked.variables.read.map((one) => one.name)).toEqual(["--b"]);
  });
});
