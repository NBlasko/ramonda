import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const EXTENSION = join(ROOT, "tools", "vscode-css");
const STAGED = join(EXTENSION, "node_modules", "@ramonda", "css");

/**
 * The plugin the extension contributes, and the two things about it that are easy to get wrong.
 *
 * The extension names `@ramonda/css/plugin` in `contributes.typescriptServerPlugins`, which VS Code
 * passes as `--globalPlugins` to BOTH of an editor's TypeScript servers — including the syntax one,
 * which never opens a `tsconfig.json` and so has no plugin of its own. Measured through a real
 * `tsserver`, formatting a file that holds a block: 20 edits without it, 0 with it.
 */
describe("the plugin the extension contributes", () => {
  test("is staged where `tsserver` looks for it, and not only in `exports`", () => {
    execFileSync("node", [join(EXTENSION, "build-plugin.mjs")], { stdio: "pipe" });

    /**
     * **A bare subpath, because `tsserver` does not read `exports`.**
     *
     * Measured: with the entry declared only in `exports`, the load from the extension FAILED and
     * the log fell through to the next candidate path — where, in this repository, the workspace's
     * own copy was found and everything looked fine. Away from the repository it would find nothing.
     */
    expect(existsSync(join(STAGED, "plugin.js"))).toBe(true);
    expect(existsSync(join(STAGED, "dist", "plugin.cjs"))).toBe(true);

    // And through Node's resolver too, which DOES read `exports` — the shim is required that way.
    const from = createRequire(join(EXTENSION, "node_modules", "x.js"));
    expect(from.resolve("@ramonda/css/plugin")).toBe(join(STAGED, "plugin.js"));
  });

  test("is a factory function, which is all `tsserver` checks before using it", () => {
    execFileSync("node", [join(EXTENSION, "build-plugin.mjs")], { stdio: "pipe" });
    const from = createRequire(join(EXTENSION, "node_modules", "x.js"));

    expect(typeof from("@ramonda/css/plugin")).toBe("function");
  });

  /**
   * The name has to be the one a project writes in its `tsconfig.json`.
   *
   * `enableGlobalPlugins` skips a global name the project already lists, which is what keeps the
   * plugin from being loaded twice in the semantic server. A different name would load both.
   */
  test("is contributed under the name a project's tsconfig uses", () => {
    const manifest = JSON.parse(readFileSync(join(EXTENSION, "package.json"), "utf8"));
    const [contributed] = manifest.contributes.typescriptServerPlugins;

    expect(contributed.name).toBe("@ramonda/css/plugin");
    /**
     * Without this, VS Code passes the NAME and never the path to find it by — measured in its own
     * `getTsServerArgs`, which adds the probe location only for the TypeScript it ships. This
     * package tells people to use the workspace version, so the flag is not optional.
     */
    expect(contributed.enableForWorkspaceTypeScriptVersions).toBe(true);
  });

  /**
   * The hand-over, which is the whole reason a shim is staged rather than the plugin.
   *
   * Contributing a plugin puts the extension's directory FIRST in `tsserver`'s candidate paths, and
   * a plugin named in a `tsconfig.json` is resolved from that same list. Measured on one project
   * before and after the contribution: `Loading @ramonda/css/plugin from …/tools/vscode-css`. So
   * without the hand-over the extension would quietly take over checking for every project,
   * replacing whatever `@ramonda/css` that project installed and pinned.
   */
  describe("and hands over to the project's own copy", () => {
    /**
     * Run in a CHILD process with `NODE_PATH` cleared, and that is not tidiness.
     *
     * pnpm puts its hoisted directory on `NODE_PATH`, so `createRequire` resolves `@ramonda/css`
     * from anywhere inside a run of these tests — including from a directory that has nothing. The
     * control passed for the wrong reason until it was moved out here. No editor sets `NODE_PATH`,
     * so this is also the environment the shim really meets.
     */
    function said(directory: string): string {
      execFileSync("node", [join(EXTENSION, "build-plugin.mjs")], { stdio: "pipe" });
      const { NODE_PATH: _hoisted, ...clean } = process.env;
      return execFileSync(
        "node",
        [join(dirname(fileURLToPath(import.meta.url)), "askTheShim.mjs"), EXTENSION, directory],
        { env: clean, encoding: "utf8" },
      );
    }

    test("when the project has one", () => {
      expect(said(join(ROOT, "apps", "playground-core"))).toContain("stands aside");
    });

    /** The control: away from a project that has one, the extension's copy is what runs. */
    test("and runs its own when the project has none", () => {
      expect(said(tmpdir())).not.toContain("stands aside");
    });
  });

  test("reaches the `.vsix`, which ignores the rest of `node_modules`", () => {
    const ignored = readFileSync(join(EXTENSION, ".vscodeignore"), "utf8");

    expect(ignored).toContain("node_modules/**");
    expect(ignored).toContain("!node_modules/@ramonda/**");
  });
});
