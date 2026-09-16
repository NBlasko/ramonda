import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { writeGenerated } from "../generate";

/**
 * Codegen actually running, which is what turns every other piece of this feature into something a
 * project can use.
 *
 * The asymmetry: a run that writes nothing is silent, and the project then has no `$` to import — so
 * every case asserting that a file WAS written is load-bearing, while the refusals are the cheap
 * half.
 */

let project: string;

/**
 * `node_modules`, because a config's own `import { kind } from "@ramonda/css/config"` is RUN.
 *
 * Without it the specifier resolved through `NODE_PATH`, which pnpm points at its hoisted
 * `.pnpm/node_modules` — so the tests were passing on an artefact of one machine's install history.
 * A clean checkout does not have `@ramonda/css` hoisted there, and the branch's first CI run failed
 * 27 tests with `Cannot find module '@ramonda/css/config'`.
 *
 * The REPOSITORY's, not the package's: a package does not contain itself.
 */
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), "ramonda-codegen-"));
  symlinkSync(join(REPO, "node_modules"), join(project, "node_modules"));
});

afterEach(() => {
  rmSync(project, { recursive: true, force: true });
});

const CONFIG = `import { kind } from "@ramonda/css/config";

export default {
  variables: {
    color: kind("color", { primary: { main: "#3b82f6" } }),
    size: kind("length", { control: { md: "30px" } }),
  },
};
`;

const write = (name: string, text: string) => writeFileSync(join(project, name), text);

/** Into the generated folder, made first — which is what codegen does before it writes. */
const writeInto = (folder: string, name: string, text: string) => {
  mkdirSync(join(project, folder), { recursive: true });
  writeFileSync(join(project, folder, name), text);
};

describe("running codegen", () => {
  test("writes both files beside the config", () => {
    write("ramonda.css.ts", CONFIG);
    const result = writeGenerated(project, ts);

    expect(result.files.map((one) => one.path)).toEqual([
      join(project, join("css-system", "variables.css")),
      join(project, join("css-system", "index.ts")),
    ]);
    expect(readFileSync(join(project, join("css-system", "variables.css")), "utf8")).toContain(
      "--color-primary-main: #3b82f6;",
    );
    expect(readFileSync(join(project, join("css-system", "index.ts")), "utf8")).toContain("--color-primary-main");
  });

  test("every declared variable is registered, which is what makes a bare `var()` safe", () => {
    write("ramonda.css.ts", CONFIG);
    writeGenerated(project, ts);

    expect(readFileSync(join(project, join("css-system", "variables.css")), "utf8").match(/@property/g)).toHaveLength(
      2,
    );
  });

  /**
   * **The trap a bundler plugin brings with it.** The plugin runs codegen, codegen writes a file the
   * bundler is watching, the write is a change, the change is a rebuild — and the plugin runs again.
   * Writing only when the CONTENT differs is what ends that, so it is asserted rather than assumed.
   */
  test("a second run with nothing changed writes nothing at all", () => {
    write("ramonda.css.ts", CONFIG);
    writeGenerated(project, ts);
    const stamped = statSync(join(project, join("css-system", "index.ts"))).mtimeMs;

    const again = writeGenerated(project, ts);

    expect(again.files.every((one) => !one.changed)).toBe(true);
    expect(statSync(join(project, join("css-system", "index.ts"))).mtimeMs).toBe(stamped);
  });

  test("a changed config is written through", () => {
    write("ramonda.css.ts", CONFIG);
    writeGenerated(project, ts);

    write("ramonda.css.ts", CONFIG.replace("#3b82f6", "#10b981"));
    const again = writeGenerated(project, ts);

    expect(again.files.some((one) => one.changed)).toBe(true);
    expect(readFileSync(join(project, join("css-system", "variables.css")), "utf8")).toContain("#10b981");
  });

  test("no config is no files, and it says which it was", () => {
    const result = writeGenerated(project, ts);

    expect(result.config).toBeUndefined();
    expect(result.files).toEqual([]);
  });

  test("a config that declares no variables writes nothing rather than two empty files", () => {
    write("ramonda.css.ts", `export default { units: { length: ["px"] } };\n`);
    const result = writeGenerated(project, ts);

    expect(result.config).toBeDefined();
    expect(result.declared).toBe(0);
    expect(result.files).toEqual([]);
  });

  test("two paths spelling one custom property stop the run", () => {
    write(
      "ramonda.css.ts",
      `import { kind } from "@ramonda/css/config";
export default { variables: { "a-b": kind("length", { c: "1px" }), a: kind("length", { "b-c": "2px" }) } };
`,
    );

    expect(() => writeGenerated(project, ts)).toThrow(/--a-b-c/);
  });
});

/**
 * A file already at the generated name, written by somebody rather than by us.
 *
 * Found by probing what each writer is willing to overwrite. Codegen wrote straight over it and
 * said nothing — and the loss is unrecoverable, because `ramonda.css.generated.*` is in
 * `.gitignore` by this package's own instruction, so there is no copy to go back to.
 *
 * The name carries `generated` and the convention is clear, which is the argument for writing
 * anyway. It is the same argument the formatter refused to accept about a placeholder a formatter
 * had eaten: *a formatter that fails is an inconvenience, one that eats a block is unrecoverable
 * work.* Looking at the target before overwriting it costs one read.
 *
 * The marker is looked for LOOSELY — the package name, not the whole sentence — so a file written
 * by an older version is still ours and is still replaced.
 */
describe("a file already at the generated name", () => {
  const declaring = `import { kind } from "@ramonda/css/config";
export default { variables: { space: kind("length", { sm: "8px" }) } };
`;

  test("one that is not ours is refused, and kept", () => {
    write("ramonda.css.ts", declaring);
    writeInto("css-system", "index.ts", "export const mine = 1; // a year of work\n");

    expect(() => writeGenerated(project, ts)).toThrow(/index\.ts/);
    expect(readFileSync(join(project, join("css-system", "index.ts")), "utf8")).toContain("a year of work");
  });

  test("the message says what to do about it", () => {
    write("ramonda.css.ts", declaring);
    writeInto("css-system", "index.ts", "export const mine = 1;\n");

    expect(() => writeGenerated(project, ts)).toThrow(/move it|rename|delete/i);
  });

  test("one of OURS is replaced, which is every ordinary run", () => {
    write("ramonda.css.ts", declaring);
    writeGenerated(project, ts);
    const first = readFileSync(join(project, join("css-system", "index.ts")), "utf8");

    // Again, over what the first run wrote — the path every watch and every build takes.
    expect(() => writeGenerated(project, ts)).not.toThrow();
    expect(readFileSync(join(project, join("css-system", "index.ts")), "utf8")).toBe(first);
  });

  test("one written by an older version is still ours", () => {
    write("ramonda.css.ts", declaring);
    writeInto("css-system", "index.ts", "/* Generated by @ramonda/css — an older sentence. */\nexport const $ = {};\n");

    expect(() => writeGenerated(project, ts)).not.toThrow();
  });

  /** The stylesheet is the other half, and it is written by the same call. */
  test("and the same is true of the stylesheet", () => {
    write("ramonda.css.ts", declaring);
    writeInto("css-system", "variables.css", ".mine { color: red; }\n");

    expect(() => writeGenerated(project, ts)).toThrow(/variables\.css/);
    expect(readFileSync(join(project, join("css-system", "variables.css")), "utf8")).toContain(".mine");
  });
});

/**
 * The generated files live in a FOLDER, and a project may name it.
 *
 * They were `css-system/index.ts` and `.css` beside the config, gitignored. The user asked for
 * both halves of this: *"ja mislim da to ne treba da bude ignorisano, kao sto se i ostale codegen
 * stvari ne ignorisu"* — and the repo's own practice agrees, since `keywords.generated.ts` is
 * committed and a gate catches drift — and *"da li je bolje da ove generisane stvari imaju svoj
 * folder, da bude cistiji setup u aplikaciji."*
 *
 * `.ramonda/` was proposed and refused, for a reason worth keeping: a leading dot reads as *not
 * committed*, and these are. The name had to be agnostic too — `@ramonda/css` is usable outside
 * Ramonda, and a folder named after the framework says nothing there and is redundant here.
 *
 * `css-system/` is what was chosen, with `outDir` to rename it. The nearest precedent is Panda CSS's
 * `styled-system/`: committed, framework-agnostic, and a shape people recognise.
 */
describe("where the generated files go", () => {
  const declaring = `import { kind } from "@ramonda/css/config";
export default { variables: { space: kind("length", { sm: "8px" }) } };
`;

  test("into `css-system/` beside the config, by default", () => {
    write("ramonda.css.ts", declaring);
    const result = writeGenerated(project, ts);

    expect(result.files.map((one) => relative(project, one.path)).sort()).toEqual([
      join("css-system", "index.ts"),
      join("css-system", "variables.css"),
    ]);
    expect(existsSync(join(project, "css-system", "index.ts"))).toBe(true);
  });

  test("the module is reachable as the folder, which is what an import writes", () => {
    write("ramonda.css.ts", declaring);
    writeGenerated(project, ts);

    // `css-system/index.ts` resolves as `css-system`, so a project writes the folder and no filename.
    expect(readFileSync(join(project, "css-system", "index.ts"), "utf8")).toContain("export const $");
  });

  test("the stylesheet is beside it, under a name that says what it holds", () => {
    write("ramonda.css.ts", declaring);
    writeGenerated(project, ts);

    expect(readFileSync(join(project, "css-system", "variables.css"), "utf8")).toContain("--space-sm");
  });

  test("`outDir` renames the folder", () => {
    write("ramonda.css.ts", `${declaring.replace("export default {", 'export default {\n  outDir: "design-system",')}`);
    const result = writeGenerated(project, ts);

    expect(result.files.map((one) => relative(project, one.path)).sort()).toEqual([
      join("design-system", "index.ts"),
      join("design-system", "variables.css"),
    ]);
  });

  /**
   * `outDir` is read TWICE, and the two readings have to agree.
   *
   * Codegen transpiles the config and gets the real value. The per-file lookups cannot — they run
   * in an editor, on every keystroke's worth of work — so they read the key out of the config's
   * TEXT. When those disagree, the files land in one folder and everything that reads them looks in
   * another, and measured, the author is told
   *
   *     TS2339  Property 'size' does not exist on type
   *             '"Declare your variables in ramonda.css.ts, then run `ramonda-css …`"'
   *
   * which is advice they have already followed. They would run it again, it would write the same
   * two files, and nothing would change. A comment that merely MENTIONS the key is enough to cause
   * it, because the text reader takes the first `outDir:` in the file.
   *
   * So the disagreement is refused where it can still be explained, rather than left to surface as
   * a sentence that is not true.
   */
  test.each([
    ["computed", 'const NAME = "design-system";\n', "  outDir: NAME,"],
    ["mentioned in a comment", '// we used to write outDir: "design-system" here\n', ""],
  ])("an `outDir` the text cannot read is refused (%s)", (_what, head, key) => {
    write("ramonda.css.ts", `${head}${declaring.replace("export default {", `export default {\n${key}`)}`);

    expect(() => writeGenerated(project, ts)).toThrow(/outDir/);
    expect(() => writeGenerated(project, ts)).toThrow(/design-system/);
  });

  test("a folder that is not ours is still refused, the same as a file was", () => {
    write("ramonda.css.ts", declaring);
    mkdirSync(join(project, "css-system"), { recursive: true });
    writeFileSync(join(project, "css-system", "index.ts"), "export const mine = 1; // a year of work\n");

    expect(() => writeGenerated(project, ts)).toThrow(/css-system/);
    expect(readFileSync(join(project, "css-system", "index.ts"), "utf8")).toContain("a year of work");
  });
});
