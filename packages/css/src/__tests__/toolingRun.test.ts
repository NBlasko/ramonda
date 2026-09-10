import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { ToolFailed } from "../tools";
import { filesUnder, formatFile, formatText, lintFile, readReport, toolIn } from "../tooling";

/**
 * What the wrappers DECIDE, asked with a tool that does exactly what a test says.
 *
 * `toolingCli.test.ts` runs the real biome and oxlint, which is the only way to know they accept
 * what they are handed — and it is slow and says nothing about the edges. This asks the edges: a
 * formatter that changed nothing, a linter that reported the scaffolding, a fault below a block.
 */

const files: string[] = [];
afterEach(() => {
  for (const each of files.splice(0)) rmSync(each, { recursive: true, force: true });
});

/** One file on disk, which is what both wrappers take. */
function file(name: string, text: string): string {
  const root = mkdtempSync(join(tmpdir(), "ramonda-css-run-"));
  files.push(root);
  writeFileSync(join(root, name), text);
  return join(root, name);
}

const STYLED = `const before = 1;
const a = (
  <div css=@@(
    display: flex;
    gap: 8px;
  )>x</div>
);
const after = 2;
`;

describe("formatting", () => {
  test("a file with no block is handed to the formatter as it is", () => {
    const path = file("Plain.ts", "const a = 1;\n");
    const seen: string[] = [];

    formatFile(
      path,
      (text) => {
        seen.push(text);
        return text;
      },
      { write: false },
    );

    expect(seen).toEqual(["const a = 1;\n"]);
  });

  test("a file with one is handed the placeholder instead", () => {
    const path = file("Card.tsx", STYLED);
    let seen = "";

    formatFile(
      path,
      (text) => {
        seen = text;
        return text;
      },
      { write: false },
    );

    expect(seen).not.toContain("@(");
    expect(seen).toContain("const after = 2;");
  });

  test("a formatter that changed nothing leaves the file alone", () => {
    const path = file("Card.tsx", STYLED);

    const { changed } = formatFile(path, (text) => text, { write: true });

    expect(changed).toBe(false);
    expect(readFileSync(path, "utf8")).toBe(STYLED);
  });

  test("`write: false` reports the change and does not make it", () => {
    const path = file("Card.tsx", STYLED);

    const { changed, text } = formatFile(path, (t) => t.replace("const before", "const  before"), { write: false });

    expect(changed).toBe(true);
    expect(text).toContain("const  before");
    expect(readFileSync(path, "utf8")).toBe(STYLED);
  });

  test("and `write: true` makes it", () => {
    const path = file("Card.tsx", STYLED);

    formatFile(path, (t) => t.replace("const before", "const  before"), { write: true });

    expect(readFileSync(path, "utf8")).toContain("const  before");
  });

  /**
   * A formatter is free to do anything, including drop the placeholder — a rule that removes an
   * expression it thinks is dead, say. The block is then unputbackable, and losing an author's
   * source is the one outcome a formatter wrapper may not have. So nothing is written at all.
   *
   * **This test used to assert the opposite of its own comment.** It checked the block was GONE,
   * which is what the code did: skip the placeholder and carry on. A review measured that with the
   * real Prettier and it cost two of six files their block, silently, on disk. The comment was
   * right and the assertion was wrong.
   */
  test("a formatter that dropped the placeholder writes nothing at all", () => {
    const path = file("Card.tsx", STYLED);
    // Either placeholder shape: a comment and a zero for a one-line block, a template literal for
    // one that spans lines.
    const drop = (t: string) => t.replace(/\w+=\{(?:\/\*[^*]*\*\/ 0|`[^`]*`)\}/, "");

    expect(() => formatFile(path, drop, { write: false })).toThrow(/placeholder/);
    // And the author's file is exactly as it was, which is the point of refusing.
    expect(readFileSync(path, "utf8")).toBe(STYLED);
  });
});

describe("linting", () => {
  /** A linter that reports one thing, at an offset a test chooses. */
  const at = (offset: number) => () => [{ message: "planted", code: "probe", labels: [{ span: { offset } }] }];

  test("a file with no block is linted as it is, and positions are its own", () => {
    const path = file("Plain.ts", "const a = 1;\nconst b = 2;\n");

    expect(lintFile(path, at("const a = 1;\n".length))).toEqual([
      { file: path, line: 2, column: 1, code: "probe", message: "planted" },
    ]);
  });

  test("a fault inside a block comes home to the author's own line", () => {
    const path = file("Card.tsx", STYLED);
    // Wherever the virtual file put `display` — read out of it rather than counted.
    const found = lintFile(path, (probe) => at(readFileSync(probe, "utf8").indexOf("display"))());

    expect(found).toEqual([{ file: path, line: 4, column: 5, code: "probe", message: "planted" }]);
  });

  test("and one below a block is not shifted by it", () => {
    const path = file("Card.tsx", STYLED);
    const found = lintFile(path, (probe) => at(readFileSync(probe, "utf8").indexOf("const after"))());

    expect(found[0].line).toBe(8);
  });

  /**
   * OFFSET ZERO is the second way a linter says "about the FILE", and it used to be the one dropped.
   *
   * A rule about the file's own NAME labels its diagnostic at the first character —
   * `unicorn/filename-case` does — and in a styled file the first character is the preamble, so
   * `homeOf` answered nothing and it went. A plain file reported the same complaint. One linter, one
   * complaint, two answers, with the styled file going quiet: the same fault the test below names,
   * arriving in the other spelling, one branch away from where it was already handled.
   *
   * **The trade is deliberate and is the one `check.ts` already makes.** A preamble diagnostic that
   * really is about this file's scaffolding now surfaces at line 1 instead of disappearing. Visible
   * and wrong beats silent and wrong, because only one of them can be reported.
   */
  test("a diagnostic at offset zero names the file, and both paths say so", () => {
    const styled = file("Card.tsx", STYLED);
    const plain = file("Plain.ts", "const a = 1;\n");

    expect(lintFile(styled, at(0))[0]).toMatchObject({ line: 1, column: 1 });
    expect(lintFile(plain, at(0))[0]).toMatchObject({ line: 1, column: 1 });
  });

  /** Past the preamble and mapping nowhere is still dropped: that is punctuation this file wrote. */
  test("a diagnostic on the scaffolding between declarations is dropped", () => {
    const path = file("Card.tsx", STYLED);
    const inside = (probe: string) => at(readFileSync(probe, "utf8").indexOf("__block([") + 8)();

    expect(lintFile(path, inside)).toEqual([]);
  });

  /**
   * No position at all is a different thing from a position that maps nowhere, and this used to
   * treat them as one.
   *
   * A diagnostic with no span names the FILE — a linter's complaint about its own setup, most often
   * — and the scaffolding is always somewhere, so it can never be the thing being reported here.
   * Grouping the two dropped it, and the path for a file with NO block reported the same complaint
   * at the top of the file: one linter, one complaint, two answers, with the styled file going
   * quiet. That is the failure this package keeps finding in other tools.
   */
  test("a diagnostic with no position names the file, and both paths say so", () => {
    const styled = file("Card.tsx", STYLED);
    const plain = file("Plain.ts", "const a = 1;\n");
    const complaint = () => [{ message: "this file is excluded by your config", code: "setup" }];

    expect(lintFile(styled, complaint)).toEqual([
      { file: styled, line: 1, column: 1, code: "setup", message: "this file is excluded by your config" },
    ]);
    expect(lintFile(plain, complaint)).toEqual([
      { file: plain, line: 1, column: 1, code: "setup", message: "this file is excluded by your config" },
    ]);
  });

  test("a linter that named no rule still gets its message through", () => {
    const path = file("Plain.ts", "const a = 1;\n");

    expect(lintFile(path, () => [{ message: "anonymous", labels: [{ span: { offset: 0 } }] }])[0].code).toBe("lint");
  });

  test("the file it is given is a copy, and it is gone afterwards", () => {
    const path = file("Card.tsx", STYLED);
    let probe = "";

    lintFile(path, (given) => {
      probe = given;
      return [];
    });

    expect(probe).not.toBe(path);
    // The same basename, so a rule that reads one — a test file, a declaration file — sees what it
    // would have seen.
    expect(probe.endsWith("Card.tsx")).toBe(true);
    expect(() => readFileSync(probe, "utf8")).toThrow();
  });
});

describe("reading what a linter printed", () => {
  test("the diagnostics out of an ordinary report", () => {
    expect(readReport(`{"diagnostics":[{"message":"m","labels":[{"span":{"offset":3}}]}]}`)).toEqual([
      { message: "m", labels: [{ span: { offset: 3 } }] },
    ]);
  });

  test("even when the tool said something else first", () => {
    // A warning about its own configuration, on the line above. The object is found rather than
    // assumed to start at the beginning.
    expect(readReport(`warning: something\n{"diagnostics":[{"message":"m"}]}`)).toEqual([{ message: "m" }]);
  });

  test("nothing at all when it printed no JSON", () => {
    expect(readReport("could not start")).toEqual([]);
  });

  test("and nothing when what it printed is not valid JSON", () => {
    // It has already said what it could. Inventing a parse error here would be a second wrong
    // answer on top of the first.
    expect(readReport("{ this is not json")).toEqual([]);
  });

  test("a report with no diagnostics at all is a clean run", () => {
    expect(readReport(`{"number_of_files":1}`)).toEqual([]);
  });
});

describe("a file that only looked like it held a block", () => {
  test("is linted as it is, because a decorator is not a block", () => {
    const path = file("Dec.ts", `class C {\n  @(dec) m() {}\n}\n`);

    expect(lintFile(path, () => [{ message: "planted", labels: [{ span: { offset: 0 } }] }])).toHaveLength(1);
  });
});

describe("which files a run is about", () => {
  /**
   * A directory is walked rather than handed on, because the two halves need different things from a
   * file and only the wrapper knows which is which. Found by running it: `ramonda-css lint src` read
   * `src` itself and threw, because a directory is not a file.
   */
  function tree(): string {
    const root = mkdtempSync(join(tmpdir(), "ramonda-css-run-"));
    files.push(root);
    mkdirSync(join(root, "src", "nested"), { recursive: true });
    mkdirSync(join(root, "src", "node_modules", "thing"), { recursive: true });
    mkdirSync(join(root, "src", ".hidden"), { recursive: true });

    for (const [path, text] of [
      ["src/a.ts", "export const a = 1;\n"],
      ["src/b.tsx", "export const b = <div />;\n"],
      ["src/nested/c.mjs", "export const c = 1;\n"],
      ["src/styles.css", ".a { color: red }\n"],
      ["src/data.json", "{}\n"],
      ["src/node_modules/thing/d.ts", "export const d = 1;\n"],
      ["src/.hidden/e.ts", "export const e = 1;\n"],
    ] as const) {
      writeFileSync(join(root, path), text);
    }
    return root;
  }

  const under = (root: string, ...paths: string[]) =>
    filesUnder(paths, root)
      .map((path) => path.slice(root.length + 1))
      .sort();

  test("every source file below a directory, and nothing else", () => {
    // A stylesheet and a JSON file are not either tool's to read here, and neither is anything under
    // `node_modules` or a dot directory — a run that formatted a dependency would be a bad day.
    expect(under(tree(), "src")).toEqual(["src/a.ts", "src/b.tsx", "src/nested/c.mjs"]);
  });

  test("a file named directly is taken as it is", () => {
    const root = tree();

    expect(under(root, "src/a.ts")).toEqual(["src/a.ts"]);
  });

  test("and a file named directly is not filtered by extension", () => {
    // Asking for one by name is a decision the caller already made.
    const root = tree();

    expect(under(root, "src/styles.css")).toEqual(["src/styles.css"]);
  });

  test("several paths at once, files and directories together", () => {
    const root = tree();

    expect(under(root, "src/nested", "src/a.ts")).toEqual(["src/a.ts", "src/nested/c.mjs"]);
  });
});

describe("finding the tool", () => {
  test("is where a project keeps its binaries", () => {
    const root = mkdtempSync(join(tmpdir(), "ramonda-css-run-"));
    files.push(root);
    mkdirSync(join(root, "node_modules", ".bin"), { recursive: true });
    writeFileSync(join(root, "node_modules", ".bin", "biome"), "");

    expect(toolIn(root, "biome")).toBe(join(root, "node_modules", ".bin", "biome"));
  });

  test("and nothing when it is not installed, so a caller can say so rather than guess", () => {
    const root = mkdtempSync(join(tmpdir(), "ramonda-css-run-"));
    files.push(root);

    expect(toolIn(root, "biome")).toBeUndefined();
  });

  /**
   * **THE SPELLING WINDOWS USES**, which this looked for and would not have found.
   *
   * npm and pnpm write THREE files into `.bin` on Windows — `biome`, `biome.cmd` and `biome.ps1` —
   * and the extensionless one is a shell script for Git Bash. `execFileSync` does not use a shell, so
   * on Windows it is the `.cmd` that can be run, and this returned the shell script.
   *
   * **Not measured, and that has to be said plainly: there is no Windows here.** What IS measured is
   * the lookup, which is what this asserts. CI runs `ubuntu-latest` for every job, so nothing in this
   * repository has ever executed on Windows — see the review note in the TODO.
   */
  test.each([".cmd", ".ps1", ".exe"])("finds the %s a Windows install writes", (extension) => {
    const root = mkdtempSync(join(tmpdir(), "ramonda-css-run-"));
    files.push(root);
    mkdirSync(join(root, "node_modules", ".bin"), { recursive: true });
    writeFileSync(join(root, "node_modules", ".bin", `biome${extension}`), "");

    expect(toolIn(root, "biome")).toBe(join(root, "node_modules", ".bin", `biome${extension}`));
  });

  /** And the extensionless one still wins where it exists, which is every POSIX install. */
  test("the plain name first, which is what a POSIX install has", () => {
    const root = mkdtempSync(join(tmpdir(), "ramonda-css-run-"));
    files.push(root);
    const bin = join(root, "node_modules", ".bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "biome"), "");
    writeFileSync(join(bin, "biome.cmd"), "");

    expect(toolIn(root, "biome")).toBe(join(bin, "biome"));
  });
});

/**
 * THE FILE'S OWN LINE ENDINGS, which the formatter chooses and the block has to follow.
 *
 * `relaid` took the newline from the BLOCK's text and the formatter took it for everything else, so
 * a review measured a CRLF file coming back with LF outside every block and CRLF inside it. Stable,
 * which is worse than random: it recurs on every save instead of healing. That is the failure
 * `relaid` was written for, arriving from the other side — and the existing tests could not see it,
 * because they all use an identity formatter, which by construction never disagrees with the block.
 *
 * So the ending comes from the text the FORMATTER handed back. It made the decision; a block is part
 * of the file it is in.
 */
describe("the line ending a block comes back with", () => {
  /** A formatter with an opinion, which is the only way to see this at all. */
  const toLf = (text: string) => text.replace(/\r\n/g, "\n");
  const toCrlf = (text: string) => text.replace(/\r?\n/g, "\r\n");

  const CRLF = "const a = 1;\r\nconst p = @@(\r\n  color: red;\r\n  gap: 8px;\r\n);\r\n";
  const LF = "const a = 1;\nconst p = @@(\n  color: red;\n  gap: 8px;\n);\n";

  test("a CRLF file formatted by a tool that writes LF comes back all LF", () => {
    const out = formatText(CRLF, "X.tsx", toLf);

    expect(out).not.toMatch(/\r/);
    expect(out).toContain("color: red;");
  });

  test("an LF file formatted by a tool that writes CRLF comes back all CRLF", () => {
    const out = formatText(LF, "X.tsx", toCrlf);

    expect(out).not.toMatch(/[^\r]\n/);
    expect(out).toContain("color: red;");
  });

  test("and it settles, rather than flipping on every save", () => {
    const once = formatText(CRLF, "X.tsx", toLf);

    expect(formatText(once, "X.tsx", toLf)).toBe(once);
  });

  /** An identity formatter made no choice, so the file keeps exactly what it had. */
  test.each([
    ["a CRLF file", CRLF],
    ["an LF file", LF],
  ])("%s is untouched by a formatter that changes nothing", (_what, source) => {
    expect(formatText(source, "X.tsx", (text) => text)).toBe(source);
  });
});

/**
 * A BLOCK THAT COULD NOT BE PUT BACK is refused, not dropped.
 *
 * `restore` skipped a placeholder it could not find and carried on. A review measured the cost with
 * the real Prettier, which recognises the template placeholder as embedded CSS and reflows it: the
 * block was gone from the output, the placeholder was left in its place, and `formatFile` with
 * `write: true` put that on disk. Two of six cases.
 *
 * There is no correct output to fall back to, so there is no output. A formatter that fails is an
 * inconvenience; a formatter that eats a block is unrecoverable work — and it did it silently, which
 * is the half that makes it unrecoverable.
 *
 * The test that used to assert the old behaviour asserted the block was GONE while its own comment
 * said losing an author's source is the one outcome this may not have. The comment was right.
 */
describe("a block the formatter moved out from under", () => {
  const drop = (text: string) => text.replace(/\w+=\{(?:\/\*[^*]*\*\/ 0|`[^`]*`)\}/, "");

  test("is refused, and says which file", () => {
    const source = "const before = 1;\nconst a = (\n  <div css=@@(\n    color: red;\n  )>x</div>\n);\n";

    expect(() => formatText(source, "Card.tsx", drop)).toThrow(/Card\.tsx/);
  });

  test("and the message says what happened, not just that it did", () => {
    const source = "const a = <div css=@@(\n  color: red;\n)>x</div>;\n";

    expect(() => formatText(source, "Card.tsx", drop)).toThrow(/placeholder/);
  });

  test("a formatter that leaves the placeholder alone is unaffected", () => {
    const source = "const a = <div css=@@(\n  color: red;\n)>x</div>;\n";

    expect(formatText(source, "Card.tsx", (text) => text)).toBe(source);
  });

  /**
   * THE TOOL'S OWN REFUSAL IS NOT THIS REFUSAL, and the caller tells them apart by type.
   *
   * The guard above was first written around the formatter call as well, which rewrapped a
   * `ToolFailed` as a plain `Error`. The CLI catches that class by name and prints the tool's
   * sentence; anything else it rethrows, so a broken `biome.json` came back as our own call stack —
   * `toolingCli.test.ts` says in as many words that it may not.
   *
   * That test runs `bin.mjs`, which reads `dist`, so it went green against a stale build and the
   * fault reached the gate. This asks the same thing of the source.
   */
  test("a tool that refuses keeps its own class on the way out", () => {
    const source = "const a = <div css=@@(\n  color: red;\n)>x</div>;\n";
    const refuse = () => {
      throw new ToolFailed("the formatter's own sentence");
    };

    expect(() => formatText(source, "Card.tsx", refuse)).toThrow(ToolFailed);
    expect(() => formatText(source, "Card.tsx", refuse)).toThrow("the formatter's own sentence");
  });
});
