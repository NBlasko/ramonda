import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { filesUnder, formatFile, lintFile, readReport, toolIn } from "../tooling";

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
  <div css=@(
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
   * expression it thinks is dead, say. The block is then lost, and losing an author's source is the
   * one outcome a formatter wrapper may not have. It is left where it was instead.
   */
  test("a formatter that dropped the placeholder does not take the block with it", () => {
    const path = file("Card.tsx", STYLED);

    const { text } = formatFile(path, (t) => t.replace(/\w+=\{\/\*[^*]*\*\/ 0\}/, ""), { write: false });

    expect(text).not.toContain("@(");
    expect(text).toContain("const after = 2;");
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
   * The scaffolding the virtual file added is not the author's, so nothing about it is shown. The
   * tests above are the control: the same wrapper does report a real position.
   */
  test("a diagnostic about the scaffolding is dropped", () => {
    const path = file("Card.tsx", STYLED);

    expect(lintFile(path, at(0))).toEqual([]);
  });

  test("a diagnostic with no position at all is dropped too", () => {
    const path = file("Card.tsx", STYLED);

    expect(lintFile(path, () => [{ message: "no idea where", labels: [] }])).toEqual([]);
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
});
