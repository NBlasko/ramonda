import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, afterEach, describe, expect, test } from "vitest";
import { builtFromThisSource } from "./built";

/** This file runs the BUILD, so a stale `dist` would measure a previous version — see `built.ts`. */
beforeAll(builtFromThisSource);

/**
 * The bin, run as a build would run it.
 *
 * `check.test.ts` covers every decision the command makes. This covers the two things only a real
 * process can show, and they are the two a build depends on: **the exit code**, and what a person
 * reads when it fails. A check that reports correctly and exits 0 is a check that does not exist.
 */

const PACKAGE = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BIN = join(PACKAGE, "bin.mjs");
/** For a fixture whose `ramonda.css.ts` imports `@ramonda/css/config`. */
const REPO = resolve(PACKAGE, "..", "..");

const projects: string[] = [];
afterEach(() => {
  for (const each of projects.splice(0)) rmSync(each, { recursive: true, force: true });
});

function project(card: string): string {
  const root = mkdtempSync(join(tmpdir(), "ramonda-css-cli-"));
  projects.push(root);
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(
    join(root, "src", "jsx.d.ts"),
    `declare namespace JSX {\n  interface IntrinsicElements { div: { css?: unknown; children?: unknown } }\n  interface Element { readonly _brand: unique symbol }\n}\n`,
  );
  writeFileSync(join(root, "src", "Card.tsx"), card);
  writeFileSync(
    join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "bundler",
        jsx: "preserve",
        types: [],
        skipLibCheck: true,
        baseUrl: ".",
        paths: { "@ramonda/css/properties": [join(PACKAGE, "src", "properties.ts")] },
      },
      include: ["src"],
    }),
  );
  return root;
}

/** What a build sees: the output, and the code it exited with. */
function run(root: string): { output: string; status: number } {
  try {
    const output = execFileSync(process.execPath, [BIN, "tsconfig.json"], { cwd: root, encoding: "utf8" });
    return { output, status: 0 };
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string; status?: number };
    return { output: `${failed.stdout ?? ""}${failed.stderr ?? ""}`, status: failed.status ?? -1 };
  }
}

describe("the bin", () => {
  test("is there before it is built, or a fresh checkout cannot link it", () => {
    // pnpm creates a package's bin links from what is on disk at install time. A bin that IS a build
    // output is not there yet, so the link is skipped and every build calling it fails.
    expect(existsSync(BIN)).toBe(true);
    expect(existsSync(join(PACKAGE, "dist", "cli.js"))).toBe(true);
  });

  test("says what it checked, and exits 0", () => {
    const { output, status } = run(project(`const a = <div css={@@( display: flex; )}>x</div>;\nexport default a;\n`));

    expect(status).toBe(0);
    expect(output).toContain("[ramonda-css]");
    expect(output).toContain("1 of them carrying a style block");
  });

  test("names the fault at the author's own line, and exits 1", () => {
    const { output, status } = run(
      project(`const a = (\n  <div css={@@(\n    dsiplay: flex;\n  )}>x</div>\n);\nexport default a;\n`),
    );

    expect(status).toBe(1);
    expect(output).toContain("src/Card.tsx:3:5");
    expect(output).toContain("Did you mean `display`?");
  });

  /**
   * "Nothing was TYPE-checked" is the claim, and the wording carries it.
   *
   * It used to say "nothing was checked", which was true of the whole run and is no longer: the CSS
   * rules that ran over files which READ are reported after the refusal now. The compiler's own
   * word is what a refusal withdraws, and only that.
   */
  test("a block it cannot read is reported first, and exits 1", () => {
    const { output, status } = run(
      project(`const a = (\n  <div css={@@(\n    {name}: 24px;\n  )}>x</div>\n);\nexport default a;\n`),
    );

    expect(status).toBe(1);
    expect(output).toContain("could not be read, so nothing was type-checked");
    // One file, and it is the one that failed — so there is nothing else to print after it.
    expect(output).not.toContain("problem(s) in files that read");
    expect(output).toContain("src/Card.tsx:3:5");
    // The position is printed once, not twice — the message carries its own and it is trimmed off.
    expect(output).not.toContain("Card.tsx:3:5  a hole");
  });
});

/**
 * The buffer an editor has, formatted without touching the file.
 *
 * ## The fault this exists for
 *
 * An editor asks a formatter about the BUFFER, not the file. A provider that pointed the command at
 * a path would format what was last saved and hand the author edits computed against text they have
 * since changed — which is how a formatter deletes work.
 *
 * It is also the only way an editor can format one of these files at all. Measured: the Biome
 * extension does nothing, because a file holding a block is excluded from `biome.json` — and with
 * the exclusion lifted biome answers *"Code formatting aborted due to parsing errors"*, because the
 * syntax is not TypeScript and `biome-ignore` is read by the parser that already failed.
 */
describe("--stdin-file-path", () => {
  /**
   * Run from the PACKAGE rather than from a throwaway project: the wrapper reaches for the biome the
   * project has, by walking up from the working directory, and a temp folder under `/tmp` has none —
   * measured, `biome is not installed here`.
   */
  const through = (source: string, args: readonly string[] = ["format", "--stdin-file-path=src/Card.tsx"]) => {
    try {
      return {
        output: execFileSync(process.execPath, [BIN, ...args], { cwd: PACKAGE, input: source, encoding: "utf8" }),
        status: 0,
      };
    } catch (error) {
      const failed = error as { stdout?: string; stderr?: string; status?: number };
      return { output: `${failed.stdout ?? ""}${failed.stderr ?? ""}`, status: failed.status ?? -1 };
    }
  };

  /**
   * **The element opens out, and that is the fix rather than a cost of it.** A block that spans
   * lines is placeheld by something that spans lines — see `compiler/tooling.ts` — so biome measures
   * the opening element as the multi-line thing it is, instead of as fourteen characters.
   *
   * Measured against the reference: `prettier`, with this package's own plugin, prints this exact
   * file exactly this way, character for character. The two formatters agreed on nothing here
   * before, and the file they disagreed about was the ordinary one.
   */
  test("formats the text it was given and writes nothing else", () => {
    const source = `const a = <div   css={@@(\n  display: flex;\n)}>x</div>;\nexport default a;\n`;
    const { output, status } = through(source);

    expect(status).toBe(0);
    expect(output).toBe(
      `const a = (\n  <div\n    css={@@(\n      display: flex;\n    )}\n  >\n    x\n  </div>\n);\nexport default a;\n`,
    );
  });

  test("a file with no block goes straight through the tool", () => {
    const { output } = through(`const a   =   1;\nexport default a;\n`);

    expect(output).toBe(`const a = 1;\nexport default a;\n`);
  });

  /** `lint` reports positions in a file, so a buffer with no name on disk is not a question it can take. */
  test("is refused for lint, with a reason", () => {
    const { output, status } = through(`const a = 1;\n`, ["lint", "--stdin-file-path=src/Card.tsx"]);

    expect(status).toBe(1);
    expect(output).toContain("is for `format`");
  });
});

/**
 * What the command does with an argument that is not a project.
 *
 * `format` and `lint` take PATHS, and the check takes a tsconfig — so `ramonda-css src/App.tsx` is
 * the mistake this command invites. Measured before it was fixed: TypeScript's JSON reader answered
 * `'{' expected.` at line 1 column 1 of the author's own source file, which reads as *your component
 * is broken* and sent one reader looking for a fault in a file that had none.
 */
/**
 * **A FILE OVER 64KB CAME BACK CUT IN HALF, and format-on-save wrote the half.**
 *
 * `--stdin-file-path` is what an editor asks: text in, formatted text out, nothing written. The
 * answer went to `process.stdout.write` and the process then called `process.exit(0)` — and
 * `process.exit` does not drain a pipe. A pipe holds 64KB, so everything past it was lost.
 *
 * Measured, on a 132,780-byte file:
 *
 *     biome directly          132780 -> 132780   complete
 *     through ramonda-css     132780 ->  65536   cut, mid-line, with no error
 *
 * The extension in `vscode/` replaces the WHOLE DOCUMENT with what comes back, so saving any file
 * over 64KB deleted the rest of it. Silently, on every save, in a published extension.
 *
 * A byte count rather than a formatting assertion: what this is about is that nothing was lost.
 */
describe("a file bigger than a pipe", () => {
  const LINES = 5000;

  test("comes back whole, not cut at 64KB", () => {
    const text =
      `const a = <div css={@@( display: flex; )}>x</div>;\n` +
      Array.from({ length: LINES }, (_, index) => `export const n${index} = ${index};`).join("\n") +
      "\n";

    /**
     * From the PACKAGE, for the reason the describe above gives: the wrapper walks up for the
     * project's own biome, and a folder under `/tmp` has none. Running it there exits before stdin
     * is read, and the parent's 132KB write then fails with `EPIPE` — which is a fixture that cannot
     * see the fault rather than a fault.
     */
    const out = execFileSync(process.execPath, [BIN, "format", "--stdin-file-path=src/Big.tsx"], {
      cwd: PACKAGE,
      input: text,
      encoding: "utf8",
    });

    expect(text.length).toBeGreaterThan(65536);
    expect(out.length).toBeGreaterThan(65536);
    // The last declaration is the one a cut takes first.
    expect(out).toContain(`export const n${LINES - 1} = ${LINES - 1};`);
  });
});

/**
 * **A MISTAKE IN YOUR CSS GETS A SENTENCE; A MISTAKE IN YOUR CONFIG GOT A STACK TRACE.**
 *
 * `ramonda.css.ts` has six ways to be wrong and every one of them has a careful sentence — a rule id
 * that is not one, with a *did you mean*; an async config; `units` as a string; a setting that is not
 * one. Measured, all six came out the same way:
 *
 *     file:///…/dist/chunk-SCWKQOHM.js:122
 *         throw new Error(`${path} ${says}`);
 *               ^
 *     Error: …/ramonda.css.ts silences `unknown-vlaue`, which is not a rule. Did you mean …
 *         at …
 *
 * The words are right and the presentation is a crash. Beside it, a fault in a BLOCK prints
 * `[ramonda-css]`, the file, the line and the sentence — same tool, same person, two shapes. This is
 * the shape reviews 14 and 16 found twice already in this file: one path handled, its sibling not.
 */
describe("a config this cannot use", () => {
  const withConfig = (config: string) => {
    const root = project(`const a = @@(\n  color: red;\n);\nexport default a;\n`);
    writeFileSync(join(root, "ramonda.css.ts"), `${config}\n`);
    return run(root);
  };

  test.each([
    ["a rule id that is not one", 'export default { rules: { "unknown-vlaue": "off" } };', "Did you mean"],
    ["an async config", 'export default async () => ({ units: { length: ["px"] } });', "is async"],
    ["units as a string", 'export default { units: "px" };', "takes families"],
    ["a setting that is not one", 'export default { unitz: ["px"] };', "not a setting"],
    ["exporting a number", "export default 5;", "must export an object"],
  ])("%s is said as a sentence, not thrown", (_what, config, expected) => {
    const { status, output } = withConfig(config);

    expect(status).toBe(1);
    expect(output).toContain(expected);
    // The words a crash brings with it, and none of them helps anybody.
    expect(output).not.toContain("throw new Error");
    expect(output).not.toMatch(/^\s+at /m);
  });

  /** And it says WHOSE file, because a monorepo has more than one. */
  test("and names the config file", () => {
    const { output } = withConfig('export default { unitz: ["px"] };');

    expect(output).toContain("ramonda.css.ts");
  });
});

describe("an argument that is not a project", () => {
  /** Run with arbitrary arguments, not the tsconfig the other tests pass. */
  function runWith(root: string, args: readonly string[]): { output: string; status: number } {
    try {
      const output = execFileSync(process.execPath, [BIN, ...args], { cwd: root, encoding: "utf8" });
      return { output, status: 0 };
    } catch (error) {
      const failed = error as { stdout?: string; stderr?: string; status?: number };
      return { output: `${failed.stdout ?? ""}${failed.stderr ?? ""}`, status: failed.status ?? -1 };
    }
  }

  test("a source file is answered by saying what this takes", () => {
    const { output, status } = runWith(project(`const a = <div css={@@( display: flex; )}>x</div>;\n`), [
      "src/Card.tsx",
    ]);

    expect(status).toBe(1);
    expect(output).toContain("tsconfig");
    expect(output).not.toContain("'{' expected");
  });

  test("a file that is not there says so, rather than reporting a parse", () => {
    const { output, status } = runWith(project(`const a = 1;\n`), ["nope.json"]);

    expect(status).toBe(1);
    expect(output).toContain("nope.json");
  });

  test("`--help` prints the usage instead of checking a project", () => {
    const { output, status } = runWith(project(`const a = 1;\n`), ["--help"]);

    expect(status).toBe(0);
    expect(output).toContain("ramonda-css");
    expect(output).toContain("format");
    expect(output).toContain("lint");
    expect(output).not.toContain("file(s) type-check");
  });

  /**
   * **ASKING FOR HELP REWROTE THE TREE.** `format` and `lint` were dispatched at the top of the file,
   * before `--help` was looked at — and `runTool` filters every `-` argument out of its paths, so
   * `--help` left none and "no paths" means the whole directory. Measured: `ramonda-css format
   * --help` rewrote a file and exited 0, having been asked what the command does.
   *
   * A person meeting a new command types `--help` first. That is the one argument that must never
   * do work.
   */
  test.each([
    ["format", "format"],
    ["lint", "lint"],
    ["format, short", "format"],
  ])("`%s --help` prints the usage and touches nothing", (_what, which) => {
    const root = project(`const a = 1;\n`);
    const messy = join(root, "src", "messy.ts");
    const before = `export const b   =   2;\n`;
    writeFileSync(messy, before);

    const { output, status } = runWith(root, [which, "--help"]);

    expect(status).toBe(0);
    expect(output).toContain("ramonda-css");
    expect(readFileSync(messy, "utf8")).toBe(before);
  });

  /**
   * And a path that is not there is answered, rather than throwing out of `node:fs`.
   *
   * `filesUnder` calls `statSync`, which throws `ENOENT` — measured, the output was a raw stack
   * trace starting `node:fs:1739`, and the exit code was the one Node picks for an uncaught throw.
   * A typo in a CI script deserves a sentence.
   */
  test.each(["format", "lint"])("`%s` on a path that is not there says which one", (which) => {
    const { output, status } = runWith(project(`const a = 1;\n`), [which, "src/Nowhere"]);

    expect(status).toBe(1);
    expect(output).toContain("src/Nowhere");
    expect(output).not.toContain("node:fs");
  });
});

/**
 * `ramonda-css codegen`, which is the command that makes `$` usable at all.
 *
 * A project with no generated module has no `$` to import, so this is not a convenience: it is the
 * step between a declared variable and a written one. In a bundler it runs on its own; this is for
 * CI, for a fresh clone, and for a project that builds with neither plugin.
 */
describe("codegen", () => {
  function bare(config: string | undefined): string {
    const root = mkdtempSync(join(tmpdir(), "ramonda-css-codegen-"));
    projects.push(root);
    symlinkSync(join(REPO, "node_modules"), join(root, "node_modules"));
    if (config !== undefined) writeFileSync(join(root, "ramonda.css.ts"), config);
    return root;
  }

  const runIn = (root: string, ...flags: string[]) => {
    try {
      return {
        output: execFileSync(process.execPath, [BIN, "codegen", ...flags], { cwd: root, encoding: "utf8" }),
        status: 0,
      };
    } catch (error) {
      const failed = error as { stdout?: string; stderr?: string; status?: number };
      return { output: `${failed.stdout ?? ""}${failed.stderr ?? ""}`, status: failed.status ?? -1 };
    }
  };

  test("writes the pair, says what it wrote, and exits 0", () => {
    const root = bare(
      `import { kind } from "@ramonda/css/config";\nexport default { variables: { color: kind("color", { primary: { main: "#3b82f6" } }) } };\n`,
    );
    const { output, status } = runIn(root);

    expect(status).toBe(0);
    expect(output).toContain("1 variable");
    expect(existsSync(join(root, join("css-system", "variables.css")))).toBe(true);
    expect(existsSync(join(root, join("css-system", "index.ts")))).toBe(true);
  });

  test("no config is said plainly, and is not a failure", () => {
    // A project may use blocks and declare no variables. Exiting non-zero would break its build for
    // a step it never asked for.
    const { output, status } = runIn(bare(undefined));

    expect(status).toBe(0);
    expect(output).toMatch(/no .*ramonda\.css\.ts/i);
  });

  /**
   * `--check` is what a repository that COMMITS the generated pair asks in CI.
   *
   * The gate that wanted it was re-deriving the whole answer: it read both files, ran codegen over
   * the author's tree and compared — so a red run left the working copy modified and then told the
   * reader to run the command it had just run for them, and it carried a second copy of the
   * `outDir` regex to find the folder at all. Codegen already knows both halves, because `put`
   * compares before writing for an unrelated reason.
   */
  describe("`--check`", () => {
    const declaring = `import { kind } from "@ramonda/css/config";\nexport default { variables: { color: kind("color", { primary: { main: "#3b82f6" } }) } };\n`;

    test("a project with no generated pair at all is stale, and nothing is written", () => {
      const root = bare(declaring);
      const { output, status } = runIn(root, "--check");

      expect(status).toBe(1);
      expect(output).toContain("css-system");
      // The half that makes it a CHECK rather than a fix: the tree it was asked about is untouched.
      expect(existsSync(join(root, join("css-system", "index.ts")))).toBe(false);
    });

    test("a pair codegen has just written agrees, and exits 0", () => {
      const root = bare(declaring);
      runIn(root);

      expect(runIn(root, "--check").status).toBe(0);
    });

    test("an output edited by hand is stale, and is NOT repaired", () => {
      const root = bare(declaring);
      runIn(root);
      const path = join(root, "css-system", "index.ts");
      writeFileSync(path, `${readFileSync(path, "utf8")}\n// @ramonda/css — edited by hand\n`);

      const { output, status } = runIn(root, "--check");

      expect(status).toBe(1);
      expect(output).toContain("index.ts");
      expect(readFileSync(path, "utf8")).toContain("edited by hand");
    });

    test("a config it refuses is said in its own words, not as a crash", () => {
      const root = bare(`// outDir: "elsewhere"\n${declaring}`);
      const { output, status } = runIn(root, "--check");

      expect(status).toBe(1);
      expect(output).toContain("outDir");
      expect(output).toContain("elsewhere");
    });
  });

  test("a collision stops it, with both paths named", () => {
    const root = bare(
      `import { kind } from "@ramonda/css/config";\nexport default { variables: { "a-b": kind("length", { c: "1px" }), a: kind("length", { "b-c": "2px" }) } };\n`,
    );
    const { output, status } = runIn(root);

    expect(status).toBe(1);
    expect(output).toContain("--a-b-c");
    expect(existsSync(join(root, join("css-system", "variables.css")))).toBe(false);
  });

  /**
   * SAID, not thrown — and the assertion above could not tell the difference.
   *
   * The note above `said` in `cli.ts` claims this: *all six ways `ramonda.css.ts` can be wrong
   * reached a person as a Node crash — `throw new Error(…)`, a caret, and a stack — while the
   * sentence inside each was careful and right.* It was made true for `ConfigError` and left false
   * for the two `refuse` helpers in `codegen.ts` and `declared.ts`, which still threw a raw one:
   *
   *     file:///…/dist/chunk-U7N5QK5K.js:1620
   *       throw new Error(`[ramonda-css] ${message}`);
   *             ^
   *     Error: [ramonda-css] `a}b` cannot be part of a variable's name.
   *         at refuse (…)  at verifyNames (…)  at writeGenerated (…)
   *
   * A crash exits 1 and prints its message too, so every assertion on status and wording passed
   * over it. The frames are the thing that separates the two, and the file's own name is what a
   * person needs: measured, the Vite build reported this fault and named no config at all.
   */
  /**
   * The other half of the same sentence: a refusal `kind()` raises while the config RUNS.
   *
   * It carries the tag and no file, because nothing that deep knows the path, so `load` adds one —
   * and it used to add both a second tag and a claim that is untrue:
   *
   *     [ramonda-css] …/ramonda.css.ts could not be read: [ramonda-css] `b` has an empty `range`…
   *
   * The file read perfectly well. A value in it is wrong, which is a different thing to be told.
   */
  test("a declaration `kind` refuses is said once, with the file and the reason", () => {
    const root = bare(
      `import { kind } from "@ramonda/css/config";\nexport default { variables: { a: kind("length", { b: { value: "8px", range: [] } }) } };\n`,
    );
    const { output, status } = runIn(root);

    expect(status).toBe(1);
    expect(output).toContain("empty `range`");
    expect(output).toContain("ramonda.css.ts");
    expect(output).not.toContain("could not be read");
    // The tag once, from the CLI that prints it — not again from inside the sentence.
    expect(output.match(/\[ramonda-css\]/g)).toHaveLength(1);
  });

  test.each([
    ["a name the stylesheet cannot hold", `{ "a}b": kind("color", { c: "red" }) }`],
    ["a value that would close the rule", `{ a: kind("color", { c: "red; }" }) }`],
    [
      "two variables spelling one custom property",
      `{ "a-b": kind("length", { c: "1px" }), a: kind("length", { "b-c": "2px" }) }`,
    ],
  ])("%s is SAID, with no stack and with the config named", (_what, variables) => {
    const root = bare(`import { kind } from "@ramonda/css/config";\nexport default { variables: ${variables} };\n`);
    const { output, status } = runIn(root);

    expect(status).toBe(1);
    expect(output).not.toMatch(/\bat \w+ \(|node:internal|\.js:\d+:\d+/);
    expect(output).toContain("ramonda.css.ts");
  });
});

/**
 * `ramonda-css explain` — what the config does to one property, and which line decided it.
 *
 * The config grew a third selector and the user said what that cost: *"sada imam samo jos jedno
 * pitanje jer smo toliko ukomplikovali da mi je tesko da pratim."* Knowing what applies to
 * `border-radius` means reading three entries and holding CSS's own classification in your head.
 *
 * `explain.test.ts` holds the claim that matters — that this agrees with what is ENFORCED. These
 * are about the command: that it runs, that it names the deciding selector, and that the two ways of
 * asking it wrongly are said rather than crashed.
 */
describe("`explain`", () => {
  const withConfig = (config: string, argument: string) => {
    const root = mkdtempSync(join(tmpdir(), "ramonda-explain-"));
    projects.push(root);
    symlinkSync(join(REPO, "node_modules"), join(root, "node_modules"));
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "p", type: "module", version: "0.0.0" }));
    writeFileSync(join(root, "ramonda.css.ts"), config);

    try {
      return {
        output: execFileSync(process.execPath, [BIN, "explain", argument], { cwd: root, encoding: "utf8" }),
        status: 0,
      };
    } catch (error) {
      const failed = error as { stdout?: string; stderr?: string; status?: number };
      return { output: `${failed.stdout ?? ""}${failed.stderr ?? ""}`, status: failed.status ?? 1 };
    }
  };

  const CONFIG = `export default {
  properties: {
    "*": { shorthand: false, arity: 1 },
    "<length>": { variablesOnly: true, units: ["px", "rem"] },
    "border-radius": { variablesOnly: false },
  },
};
`;

  test("names the selector that decided each setting, and the one it overrode", () => {
    const { output, status } = withConfig(CONFIG, "border-radius");

    expect(status).toBe(0);
    expect(output).toContain('"*"');
    expect(output).toContain('"<length>"');
    expect(output).toContain('overriding "<length>"');
    expect(output).toContain("px, rem");
  });

  test("a property the kind reaches but the config never names", () => {
    const { output } = withConfig(CONFIG, "padding-left");

    expect(output).toContain('"<length>"');
    expect(output).not.toContain("overriding");
  });

  test("a property CSS does not have is said, with the nearest one", () => {
    const { output, status } = withConfig(CONFIG, "pading-left");

    expect(status).toBe(1);
    expect(output).toContain("padding-left");
  });

  test("no property at all is said rather than crashed", () => {
    const root = mkdtempSync(join(tmpdir(), "ramonda-explain-"));
    projects.push(root);
    let out = "";
    let status = 0;
    try {
      out = execFileSync(process.execPath, [BIN, "explain"], { cwd: root, encoding: "utf8" });
    } catch (error) {
      const failed = error as { stdout?: string; stderr?: string; status?: number };
      out = `${failed.stdout ?? ""}${failed.stderr ?? ""}`;
      status = failed.status ?? 1;
    }

    expect(status).toBe(1);
    expect(out).toContain("takes a property");
    expect(out).not.toContain("throw new Error");
  });

  test("a project with no config is told so rather than shown an empty table", () => {
    const root = mkdtempSync(join(tmpdir(), "ramonda-explain-"));
    projects.push(root);
    writeFileSync(join(root, ".git"), "");

    const output = execFileSync(process.execPath, [BIN, "explain", "padding-left"], { cwd: root, encoding: "utf8" });

    expect(output).toContain("nothing is narrowed");
  });

  /** `--help` must never do work — the rule the formatter learned the hard way. */
  test("`--help` prints the usage, which now lists this command", () => {
    const output = execFileSync(process.execPath, [BIN, "explain", "--help"], { cwd: PACKAGE, encoding: "utf8" });

    expect(output).toContain("ramonda-css explain");
  });
});
