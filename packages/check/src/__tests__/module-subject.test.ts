import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = () => analyzeProject(join(here, "fixtures", "module-subject", "tsconfig.json"));
const linesOf = (issues: readonly { line: number }[]) => issues.map((issue) => issue.line);

/**
 * The module subject, walked through `.claude/skills/writing-a-static-rule`.
 *
 * One of the two was reporting a documented, working Vite feature, and the other could not read the
 * same env variable written with brackets instead of a dot.
 */
describe("a module rule asked about the shape one step away", () => {
  /**
   * What a bundler can split, MEASURED with Vite 7 rather than reasoned about.
   *
   * `` import(`./pages/${w}.js`) `` emits a chunk per matching file — two of them in the probe. Drop
   * the suffix, or the leading `./`, and nothing is emitted at all: one module transformed, no
   * chunk. So the template is splittable only with BOTH halves, and the rule reporting it was
   * reporting a documented feature working exactly as documented.
   */
  test("a template with a relative head and a suffix is splittable, and is not reported", () => {
    const found = run().findings["unsplittable-import"];

    // 16 is the splittable template. 17 has no suffix, 18 is not relative, 19 is a bare name.
    expect(linesOf(found)).toEqual([17, 18, 19]);
    expect(found.map((issue) => issue.path)).toEqual(["`./pages/${which}`", "`pages/${which}.ts`", "SPECIFIER"]);
  });

  /** A literal path, and one the bundler was told about, are both silent. */
  test("a literal path and a `@vite-ignore` are left alone", () => {
    expect(linesOf(run().findings["unsplittable-import"])).not.toContain(15);
    expect(linesOf(run().findings["unsplittable-import"])).not.toContain(20);
  });

  /**
   * `import.meta.env["VITE_API_URL"]` is the same read as `import.meta.env.VITE_API_URL`, and the
   * rule saw only the dot. A name holding the key is the same read one hop further.
   */
  test("an env name is read through brackets, and through a name", () => {
    const found = run().findings["unexposed-env-read"];

    expect(linesOf(found)).toEqual([27, 28, 29]);
    for (const issue of found) expect(issue.name).toBe("VITE_API_URL");
  });

  /** What must stay silent: a computed key, the public prefix, and a name the bundler provides. */
  test("a key this cannot read, the public prefix and a built-in are not reported", () => {
    const found = linesOf(run().findings["unexposed-env-read"]);

    expect(found).not.toContain(30);
    expect(found).not.toContain(31);
    expect(found).not.toContain(32);
  });
});
