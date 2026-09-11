import { describe, expect, test } from "vitest";
import { transform } from "../compiler/transform";
import { checkedSource } from "../compiler/source";

/**
 * THE ESCAPE HATCH, and why a package this strict has to have one.
 *
 * Every rule here fails a build; there is no warning level, and that was decided on purpose. It is
 * only bearable while no rule is ever wrong — and the first rule that is wrong once means a person
 * switches the whole tool off, which is worse than any finding it could have made.
 *
 * The framework's own checker has had `// ramonda-check-ignore <reason>` since severities were
 * removed. This is the same thing for the same reason, and it lives in `@ramonda/css` rather than
 * there because this package is meant to be usable from another JSX library, where nothing of the
 * framework is installed.
 */
const rules = (source: string) => checkedSource(source, "C.tsx").findings.map((one) => one.rule);

const built = (source: string): string | undefined => {
  try {
    transform(source, { filename: "C.tsx" });
    return undefined;
  } catch (error) {
    return (error as Error).message;
  }
};

describe("a finding an author took responsibility for", () => {
  const WRONG = "const a = <div css={@@(\n  display: flexx;\n)}>x</div>;\n";
  const EXEMPT =
    "const a = <div css={@@(\n  /* ramonda-css-ignore a vendor sheet defines it */\n  display: flexx;\n)}>x</div>;\n";

  test("is reported without the directive", () => {
    expect(rules(WRONG)).toEqual(["unknown-value"]);
  });

  test("and is not reported with it", () => {
    expect(rules(EXEMPT)).toEqual([]);
  });

  /**
   * The BUILD honours it too, which is what makes it an escape rather than a way to lose an
   * afternoon: a directive that silenced the checker and left the build failing would meet the
   * person again one command later, with nothing to do about it.
   */
  test("the build refuses without it, and compiles with it", () => {
    expect(built(WRONG)).toContain("flexx");
    expect(built(EXEMPT)).toBeUndefined();
  });

  /** It is LINE scoped, so it cannot creep past the line the author looked at. */
  test("the line after the next one is still reported", () => {
    const source =
      "const a = <div css={@@(\n  /* ramonda-css-ignore this one */\n  display: flexx;\n  color: redd;\n)}>x</div>;\n";

    expect(rules(source)).toEqual(["unknown-value"]);
  });

  test("and so is the line before it", () => {
    const source =
      "const a = <div css={@@(\n  color: redd;\n  /* ramonda-css-ignore this one */\n  display: flexx;\n)}>x</div>;\n";

    expect(rules(source)).toEqual(["unknown-value"]);
  });

  /**
   * A JavaScript comment carries it as well as a CSS one. The scan reads no comment syntax, because
   * a block is CSS and the code around it is TypeScript — and a finding can be on either.
   */
  test("a `//` comment carries it too", () => {
    const source =
      "// ramonda-css-ignore not one this compiles yet\nconst k = @@keyfrmes(\n  from { opacity: 0; }\n);\n";

    expect(rules(source)).toEqual([]);
  });

  /**
   * **THE OTHER PLACE A PERSON WRITES IT — at the end of the line that is wrong.**
   *
   * Every linter has both spellings, and the tests above only ever measured one. Measured on the
   * other: the directive covered the line BELOW, so the fault it was written for was still reported
   * and a line the author never looked at was silenced instead — "it cannot creep past what the
   * author looked at" was true of the wrong line.
   *
   * One marker still, and the two are told apart by what is in front of it: a directive ALONE on its
   * line is about the line below, and one following code is about the code it follows. That is what
   * the two spellings already mean everywhere else, and it needs no second word to learn.
   */
  test("at the end of the line it is about", () => {
    const source = "const a = <div css={@@(\n  display: flexx; /* ramonda-css-ignore a vendor sheet */\n)}>x</div>;\n";

    expect(rules(source)).toEqual([]);
  });

  test("and one following code does NOT reach the line below it", () => {
    const source =
      "const a = <div css={@@(\n  color: red; /* ramonda-css-ignore this line is fine */\n  display: flexx;\n)}>x</div>;\n";

    expect(rules(source)).toEqual(["unknown-value"]);
  });

  /** Alone on its line still means the line below, which is what the tests above rely on. */
  test("alone on its line, in a `//` comment, above the declaration", () => {
    const source =
      "const a = 1; // ramonda-css-ignore about the line below\nconst b = <div css={@@( display: flexx; )}>x</div>;\n";

    // Following code, so it is about `const a = 1;` — which has no finding — and the block is
    // reported. The two spellings cannot both be about the same line.
    expect(rules(source)).toEqual(["unknown-value"]);
  });

  test("the build honours the end-of-line spelling too", () => {
    const source = "const a = <div css={@@(\n  display: flexx; /* ramonda-css-ignore a vendor sheet */\n)}>x</div>;\n";

    expect(built(source)).toBeUndefined();
  });
});

describe("a directive with nothing after it", () => {
  const SILENT = "const a = <div css={@@(\n  /* ramonda-css-ignore */\n  display: flexx;\n)}>x</div>;\n";

  /**
   * An empty reason is a silence rather than a record, and it is refused — so the exemption below it
   * is NOT honoured either. Both come back, which is the answer that leaves nothing hidden.
   */
  test("is itself a finding, and does not exempt what follows", () => {
    expect(rules(SILENT)).toEqual(["ignore-without-a-reason", "unknown-value"]);
  });

  test("the build refuses it, naming the directive rather than the line below", () => {
    expect(built(SILENT)).toContain("not a record");
  });

  /** And it cannot exempt ITSELF: the directive is on its own line, and the scope is the next one. */
  test("two of them are both reported", () => {
    const source =
      "const a = <div css={@@(\n  /* ramonda-css-ignore */\n  /* ramonda-css-ignore */\n  color: red;\n)}>x</div>;\n";

    expect(rules(source)).toEqual(["ignore-without-a-reason", "ignore-without-a-reason"]);
  });
});

describe("what a run can say about them", () => {
  /**
   * Returned rather than swallowed. An exemption is a decision, and a decision nobody can see is a
   * silence — the CLI prints every one on every run, whether or not anything failed, so a reason
   * that has stopped being true is one somebody meets rather than one they would have to grep for.
   */
  test("the reason and the line it covers come back", () => {
    const source =
      "const a = <div css={@@(\n  /* ramonda-css-ignore a vendor sheet defines it */\n  display: flexx;\n)}>x</div>;\n";
    const { ignored } = checkedSource(source, "C.tsx");

    expect(ignored).toHaveLength(1);
    expect(ignored[0].reason).toBe("a vendor sheet defines it");
    expect(ignored[0].line).toBe(3);
  });

  test("a file with none returns none, and pays one substring search", () => {
    expect(checkedSource("const a = <div css={@@( color: red; )}>x</div>;\n", "C.tsx").ignored).toEqual([]);
  });
});
